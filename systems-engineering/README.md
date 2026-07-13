# systems-engineering/

A requirements baseline for the STL Webcams dashboard, written as a
**learning exercise** in turning plain-language wishes into standards-conformant
requirements (INCOSE / ISO-IEC-IEEE 29148 / NASA / DoD) and seeing where gaps and
ambiguities form. Isolated from the app's development thread on its own branch.

**Baseline:** commit `b38ad51`.

## Files
| File | What it is |
|------|-----------|
| `System-Requirements-Specification.md` | The SyRS: purpose, conventions, structure, V&V approach, and the **§7 ambiguity/gap analysis** (start here) |
| `stakeholder-needs.csv` | `STK-nnn` — plain-language needs with verbatim source quotes |
| `requirements.csv` | `SYS-nnn` — the "shall" statements + attributes (**authoritative**) |
| `verification.csv` | `VER-nnn` — the Verification Cross-Reference Matrix (method / criteria / status) |
| `change-requests.csv` | `CR-nnn` — post-baseline changes, traced to requirements |
| `trace-check.py` | Traceability + consistency audit; run after any edit |
| `SE-MEMORY.md` | Portable context to resume the systems-engineer persona in a new session |

## Use it
```
python3 systems-engineering/trace-check.py    # must exit 0
```
The CSVs are hand-editable and are the source of truth. After editing, keep
`parent` (trace-up) and a matching `verification.csv` row filled, then re-run the
audit. See `SE-MEMORY.md` for conventions and how to extend.

## At a glance (baseline b38ad51)
- 15 stakeholder needs → 40 system requirements → 40 verification cases.
- Audit: 15/15 needs covered, 40/40 requirements verified, 0 findings.
- Verification status: 38 PASS · 1 FAIL (`SYS-014`, continuous playback) · 1 N/A (`SYS-100`, scope boundary undefined).
- 9 open TBD/TBR (SRS §7.1) — the deliberate discussion points.
