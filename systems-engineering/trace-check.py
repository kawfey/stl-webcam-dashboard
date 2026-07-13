#!/usr/bin/env python3
"""Traceability & consistency audit for the requirements baseline.

Checks the properties ISO/IEC/IEEE 29148:2018 asks of a *set* of requirements
(complete, consistent, traceable) plus INCOSE bidirectional-traceability
practice. Reads the sibling CSVs; exits non-zero if any hard finding is raised.

    python3 systems-engineering/trace-check.py
"""
import csv, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(fn):
    with open(os.path.join(HERE, fn), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def split_ids(cell):
    return [t.strip() for t in re.split(r"[;,]", cell or "") if t.strip()]


def main():
    needs = load("stakeholder-needs.csv")
    reqs = load("requirements.csv")
    vers = load("verification.csv")

    need_ids = {n["id"] for n in needs}
    req_ids = {r["id"] for r in reqs}
    findings, warnings = [], []

    # 1. Every requirement traces up to a known need or requirement.
    for r in reqs:
        parents = split_ids(r["parent"])
        if not parents:
            findings.append(f"{r['id']}: no parent (untraced requirement)")
        for p in parents:
            if p not in need_ids and p not in req_ids:
                findings.append(f"{r['id']}: parent {p!r} not found")

    # 2. Every requirement is covered by >=1 verification entry
    #    (unless it is not-yet-verifiable, e.g. blocked on a TBD).
    verified = set()
    for v in vers:
        for rid in split_ids(v["req_id"]):
            verified.add(rid)
            if rid not in req_ids:
                findings.append(f"{v['id']}: req_id {rid!r} not found")
    for r in reqs:
        if r["id"] not in verified:
            if r["verify_status_b38ad51"] in ("N/A", "BLOCKED"):
                warnings.append(f"{r['id']}: no verification (status {r['verify_status_b38ad51']})")
            else:
                findings.append(f"{r['id']}: no verification entry")

    # 3. Every stakeholder need is satisfied by >=1 requirement (no orphan needs).
    satisfied = set()
    for r in reqs:
        satisfied |= {p for p in split_ids(r["parent"]) if p in need_ids}
    for n in needs:
        if n["id"] not in satisfied:
            warnings.append(f"{n['id']}: no requirement traces to this need (orphan need)")

    # 4. Conformance: each requirement uses the normative 'shall'.
    for r in reqs:
        if " shall " not in f" {r['requirement']} ":
            warnings.append(f"{r['id']}: requirement text has no 'shall'")

    # ---- report ----
    vcount = {}
    for r in reqs:
        vcount[r["verify_status_b38ad51"]] = vcount.get(r["verify_status_b38ad51"], 0) + 1
    print(f"needs={len(needs)}  requirements={len(reqs)}  verifications={len(vers)}")
    print("verify status @baseline:", ", ".join(f"{k}={v}" for k, v in sorted(vcount.items())))
    print(f"traceability: {len(satisfied)}/{len(need_ids)} needs covered, "
          f"{len(verified & req_ids)}/{len(req_ids)} requirements verified")

    for w in warnings:
        print("WARN:", w)
    for f in findings:
        print("FAIL:", f)
    print(f"\n{len(findings)} finding(s), {len(warnings)} warning(s)")
    sys.exit(1 if findings else 0)


if __name__ == "__main__":
    main()
