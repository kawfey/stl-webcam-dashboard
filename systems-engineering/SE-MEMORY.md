# SE-MEMORY — Systems Engineering worker context (portable)

> Portable working memory for the **systems-engineer persona** on the STL
> Webcams project. It lives in the repo (not in the app's auto-loaded
> `~/.claude/.../memory/`) so it travels with the branch and does **not** leak
> into the main development thread. To resume this workstream in any session,
> read this file first.

## Role
Act as a systems engineer. Produce and maintain standards-conformant
requirements, traceability, and verification for the dashboard, baselined to a
specific commit. Optimize for *learning*: make interpretations explicit, and
surface ambiguities/gaps rather than paper over them. Do **not** implement app
features from this persona — that is the development thread's job.

## Standards followed (cite by title; verify clause numbers against a real copy)
- **ISO/IEC/IEEE 29148:2018** — requirements engineering (StRS/SyRS/SRS;
  shall/should/may/will; individual & set characteristics). Governing doc.
- **INCOSE Guide for Writing Requirements (GtWR) v4** — need vs requirement;
  writing rules; non-intelligent identifiers.
- **INCOSE SE Handbook 5th ed.** — process; verification vs validation.
- **NASA/SP-2016-6105 Rev2** — "how to write a good requirement"; I/A/D/T; VCRM.
- **MIL-STD-961E** — DoD spec/"shall" lineage. **IEEE 830** — historical only.

## Method / tooling (chosen: CSV + Markdown in git)
Everything lives in `systems-engineering/`:
- `stakeholder-needs.csv` — STK-nnn: plain-language needs + verbatim source quote.
- `requirements.csv` — SYS-nnn: the shall statements + attributes (authoritative).
- `verification.csv` — VER-nnn: the VCRM (method, statement, criteria, status).
- `change-requests.csv` — CR-nnn: post-baseline changes, traced to requirements.
- `System-Requirements-Specification.md` — the SyRS narrative + §7 gap analysis.
- `trace-check.py` — audits set characteristics; **run after every edit**, must exit 0.
- `README.md` — orientation.

Conventions: IDs are non-intelligent & stable (category is a column, not in the
ID). One "shall" per requirement. Verify methods = I/A/D/T. TBD = To Be
Determined, TBR = To Be Resolved.

## Baseline
- **b38ad51** ("Geolocate 13 cameras from user survey data").
- Branch **`systems-engineering`**, cut from b38ad51 so the app dev thread
  (`locate-cameras`) is untouched. Commit **only** `systems-engineering/` files;
  the working tree may carry the dev thread's unrelated uncommitted changes —
  never stage those.

## Status (2026-07-13)
- v1.0 baseline complete: 15 needs, 40 requirements, 40 verifications, 10 CRs.
- Audit clean: 15/15 needs covered, 40/40 verified, 0 findings.
- Verify status @baseline: **38 PASS, 1 FAIL (SYS-014 continuous playback —
  wetmet black-screen), 1 N/A (SYS-100 scope — boundary undefined)**.
- Not pushed (local only), consistent with the project's no-deploy workflow.

## Open items to work with the stakeholder (the learning surface)
9 TBD/TBR in SRS §7.1. Highest-value elicitations: TBD-001 ("St. Louis area"
boundary), TBR-006 (status state model), TBD-007 (performance targets),
TBR-009 (PTZ FOV depiction), TBD-008 (accessibility target — none stated).

## How to extend
1. Add/modify rows in the CSVs (they are the source of truth; hand-editable).
2. Keep `parent` trace-up filled and add a matching `verification.csv` row.
3. Run `python3 systems-engineering/trace-check.py` — must exit 0.
4. New stakeholder input → capture verbatim in `stakeholder-needs.csv` first,
   then derive `SYS-*`; log interpretations in SRS §7.2.
5. Re-baseline only at a named commit; record the change in git + SRS §6.

## Guardrails
- Requirements are testable statements of *what/constraint*, not design. When a
  wish is unquantified, write the testable part and open a TBD rather than invent
  a number silently (but record the working assumption).
- Distinguish stakeholder-requested vs implementer-derived requirements
  (`origin` column) — derived ones are where scope quietly grows.
