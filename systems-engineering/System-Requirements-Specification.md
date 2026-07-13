# STL Webcams — System Requirements Specification (SyRS)

**Baseline:** `b38ad51` ("Geolocate 13 cameras from user survey data")
**Document status:** Initial baseline (reverse-engineered from stakeholder inputs and implementation decisions)
**Prepared by:** Claude, acting as systems engineer
**Date:** 2026-07-13

> This is a *learning artifact*. It reconstructs a requirements baseline for an
> existing hobby web app in order to practice writing standards-conformant
> requirements and to expose where plain-language wishes hide ambiguity. It is
> deliberately explicit about assumptions and gaps. Section 7 is the payload.

---

## 1. Introduction

### 1.1 Purpose
Define, at the system level, what the STL Webcams dashboard shall do and the
constraints it shall satisfy, and establish a verifiable, traceable baseline
against commit `b38ad51`.

### 1.2 System overview
STL Webcams is a client-only (no server, no build step) single-page web
application that displays St. Louis–area webcams in three views — **Streams**,
**Stills**, and **Map** — reading a generated `data/cameras.json` at runtime.
It evolved from a Home Assistant Lovelace dashboard; the camera inventory lives
in CSVs (`data/cameras.csv`, `data/locations.csv`) converted by
`data/convert.py`. It is published via GitHub Pages.

### 1.3 Scope of this baseline
Functions, interfaces, data, quality attributes, and constraints **as built at
`b38ad51`**. Post-baseline change requests (the 2026-07-13 bug/feature list and
the viewshed feature) are captured as CRs in `change-requests.csv` and are **not**
part of this baseline.

### 1.4 Definitions
- **Camera** — an entry in the inventory that yields a viewable feed (stream,
  still image, or link-out). *Ambiguous at baseline — see §7, TBD-005.*
- **View** — a named grouping/tab (Streams, Stills, Map).
- **FOV wedge** — the map sector showing a camera's horizontal field of view.
- **PTZ** — pan/tilt/zoom camera (direction varies over time).
- **ASL / AGL** — above sea level / above ground level.
- **VCRM** — Verification Cross-Reference Matrix (`verification.csv`).
- **TBD / TBR** — To Be Determined / To Be Resolved (INCOSE placeholders).

### 1.5 Reference standards
This baseline follows the intent of the documents below. Where a clause is
named, confirm the exact number against your copy — they are cited by title to
avoid transcription error.

| Ref | Standard | Used for |
|-----|----------|----------|
| [R1] | **ISO/IEC/IEEE 29148:2018** — Requirements engineering | StRS/SyRS structure; requirement language (shall/should/may/will); characteristics of individual requirements and of a requirement set |
| [R2] | **INCOSE Guide for Writing Requirements (GtWR), v4** | Need-vs-requirement distinction; requirement characteristics and writing rules |
| [R3] | **INCOSE Systems Engineering Handbook, 5th ed. (2023)** | Requirements definition process; verification vs validation |
| [R4] | **NASA/SP-2016-6105 Rev2** — NASA Systems Engineering Handbook | "How to write a good requirement" (App. C); verification methods; VCRM |
| [R5] | **MIL-STD-961E** — DoD/program-unique specifications | "shall" convention; specification content/format lineage |
| [R6] | **IEEE Std 830-1998** (superseded by [R1]) | Historical SRS practice; noted for lineage only |

---

## 2. Requirements conventions

### 2.1 Language keywords (per [R1])
- **shall** — a binding requirement (the only keyword used for requirements here).
- **should** — a goal/recommendation (non-binding).
- **may** — permission/option.
- **will** — a statement of fact or intent (e.g., about the environment), not a requirement.

### 2.2 Identifiers
Requirement IDs (`SYS-nnn`) and need IDs (`STK-nnn`) are **non-intelligent and
stable** (per [R2]): the number carries no meaning and is never reused or
renumbered when requirements are recategorized. Category is a separate
attribute, not encoded in the ID.

### 2.3 Requirement attributes (columns in `requirements.csv`)
`id, category, requirement, rationale, parent (trace-up), origin (User /
Claude-derived), verify_method, verify_status_b38ad51, priority, status, notes`.

### 2.4 Characteristics each requirement targets (per [R1]/[R2])
Necessary · Appropriate · Unambiguous · Complete · **Singular** (one "shall"
each) · Feasible · **Verifiable** · Correct · Conforming. Where a baseline
requirement violates one (e.g., an unquantified term), it is flagged in §7
rather than silently "fixed" — the gaps are the lesson.

### 2.5 Verification methods (per [R4]/[R5])
- **I — Inspection**: examine the item/artifact (e.g., read the code, grep).
- **A — Analysis**: reason/model/calculate (e.g., the wedge geometry).
- **D — Demonstration**: operate and observe qualitatively (e.g., click a pin).
- **T — Test**: exercise against measurable pass/fail criteria (e.g., refresh interval).

---

## 3. System requirements

The authoritative, machine-checkable requirement set is **`requirements.csv`**
(40 requirements). This section gives the structure and a few exemplars; it does
not restate every row.

| Category | Count | Example |
|----------|------:|---------|
| Functional — Navigation | 3 | SYS-001 ≥3 named views (Streams/Stills/Map) |
| Functional — Streams | 5 | SYS-011 prefer hls.js when supported; native HLS only as fallback |
| Functional — Stills | 2 | SYS-020 refresh still images at ≤30 s while visible |
| Functional — Link-out | 1 | SYS-030 open source page in a new context |
| Functional — Map | 6 | SYS-041 FOV wedge = azimuth ± fov/2, 0°=N clockwise |
| Functional — Status | 1 | SYS-050 indicate non-live status |
| Data | 7 | SYS-062 derive azimuth/fov from left/right edge headings |
| Interface (external/map) | 4 | SYS-046 attribute OpenStreetMap |
| Design | 2 | SYS-044 geodesic wedge geometry |
| Constraint (architecture/usability) | 6 | SYS-080 static, no server, no build step |
| Deployment / Portability | 4 | SYS-091 publish on push to default branch |
| Performance | 1 | SYS-004 mount media only for the active view |
| Scope | 1 | SYS-100 limit to the St. Louis area *(TBD boundary)* |

**Exemplar (well-formed):**
> **SYS-041** — For each camera that has both an azimuth and a field-of-view, the
> Map view shall render a field-of-view wedge spanning azimuth ± (fov/2) using
> compass bearings (0° = North, increasing clockwise).

Singular, verifiable (Analysis + Demonstration), unambiguous (convention fixed).

**Exemplar (implied requirement exposing a gap):**
> **SYS-014** — While a live stream card is displayed and visible, the dashboard
> shall maintain continuous playback of that stream.

Never explicitly stated by the stakeholder, but clearly *expected* (the black-screen
report proves it). At baseline this **fails** (ANOM-001). Documenting it makes the
gap visible and verifiable rather than tacit.

---

## 4. Verification & Validation

### 4.1 Verification vs. validation (per [R3])
- **Verification** — "Did we build the system right?" i.e., does it meet the
  `SYS-*` requirements. Covered by `verification.csv` (the VCRM).
- **Validation** — "Did we build the right system?" i.e., does it satisfy the
  `STK-*` stakeholder needs in intended use. Primary evidence: the stakeholder
  operating the dashboard and confirming fitness (informal at this project scale).

### 4.2 VCRM
`verification.csv` maps every requirement to ≥1 verification case (method,
statement, success criteria, level, status@baseline, evidence). Baseline result:
**38 PASS, 1 FAIL (SYS-014), 1 BLOCKED/N-A (SYS-100)**.

### 4.3 Known anomalies against baseline
| Anomaly | Requirement | Description | Disposition |
|---------|-------------|-------------|-------------|
| ANOM-001 | SYS-014 | wetmet iframe feeds stall to a black frame after minutes; reload/click resumes | CR-002 / CR-006 (dev thread) |
| ANOM-002 | SYS-012 (quality) | some wetmet feeds overflow the card and capture page scroll | CR-001 |
| ANOM-003 | data availability | MO DNR still URL required a Drupal `itok` token; bare URL intermittently 404s | Addressed post-baseline |

---

## 5. Traceability

Bidirectional traceability (per [R1]/[R3]) is maintained by the `parent` column
(requirement → need/parent-requirement) and the VCRM (`req_id`). The audit tool
**`trace-check.py`** enforces the *set* characteristics: every requirement traces
up, every requirement is covered by verification, every need is satisfied by ≥1
requirement, and every requirement is conforming ("shall"). Baseline audit:
`15/15 needs covered, 40/40 requirements verified, 0 findings`.

---

## 6. Baseline & configuration management

- **Baseline ID:** commit `b38ad51` on branch `systems-engineering`.
- **Change control:** post-baseline changes enter as CRs in `change-requests.csv`
  (CR-001…), each traced to affected requirements, dispositioned before any
  requirement text changes. Requirement edits are made by revising the CSV and
  re-running `trace-check.py`; git history is the change record.
- **Relationship to development:** the app itself is developed on other branches
  (`locate-cameras` etc.). This SE baseline is intentionally isolated so it does
  not perturb the development thread.

---

## 7. Ambiguities, gaps, TBD/TBR, and assumptions

The heart of the exercise: where the plain-language inputs were incomplete, and
what had to be assumed. Each item is a place a real program would push back on
the stakeholder before committing to a "shall."

### 7.1 Open TBD/TBR register
| ID | Requirement | Issue | Assumed value @baseline | Needs |
|----|-------------|-------|-------------------------|-------|
| TBD-001 | SYS-100 | "St. Louis area" has no defined boundary; dataset includes feeds ~80–130 km out (Cuba, Farmington, Edwardsville) | none (unbounded) | A boundary rule (county set? radius? MSA?) |
| TBR-002 | SYS-020 | Still-image refresh interval never specified | 20 s (implementer's choice) | Confirm/derive from source update cadence |
| TBR-003 | SYS-048 | FOV wedge length arbitrary | 1600 m fixed | Per-camera landmark distance (CR-011) |
| TBD-004 | SYS-082 | "mobile" min width unspecified | ≥320 px | Target device/viewport set |
| TBD-005 | §1.4 | "webcam" undefined; non-cameras (ADS-B, YouTube) had leaked in | curated by hand | A definition/inclusion rule |
| TBR-006 | SYS-050 | Status taxonomy (live/offline/event_only/dead) semantics & transitions undefined | ad hoc strings | State model + transition rules |
| TBD-007 | SYS-004/STK-011 | "don't overload the browser" unquantified | active-view-only heuristic | Concurrency/load-time targets |
| TBD-008 | (none) | No accessibility requirements stated | partial ARIA only | Decide conformance target (e.g., WCAG level) |
| TBR-009 | SYS-041 | PTZ cameras: instantaneous vs. swept FOV representation undecided | sweep-envelope wedge or pin | A PTZ depiction rule |

### 7.2 Ambiguities resolved by implementer interpretation (recorded for trace)
- **Azimuth "left/right" convention.** "Left/right extent" was ambiguous until
  fixed as *left = counter-clockwise edge; sweep clockwise to right*
  (`fov = (right−left) mod 360`, `az = left + fov/2`). Cross-checked: left 359°,
  right 69° → az 34° (NE). *(SYS-062)*
- **Arch Park E/W pin offset.** Two cameras share the Arch; pins were offset
  E/W to declutter — a deliberate deviation from true position, documented in
  `locations.csv`.
- **WWT Raceway coordinates.** Camera location is an implementer estimate at the
  raceway grandstand from the stakeholder's geoguess; flagged "verify."

### 7.3 Requirements that originated as implementer decisions, not stakeholder asks
These are legitimate derived requirements but were *not* requested; each is a
place scope silently expanded (marked `origin = Claude (derived)` in the CSV):
SYS-011 (hls.js-first), SYS-021 (cache-busting), SYS-044 (geodesic geometry),
SYS-046 (OSM attribution — a *compliance* obligation nobody asked for but the
license requires), SYS-071 (referrer policy), SYS-081 (vendoring / no CDN).

### 7.4 Needs → requirements transformation notes
- A single wish often fans out into several requirements: STK-005 ("location AND
  field of view on a map") became SYS-040/041/044/045/046/047 — and surfaced an
  *unrequested* obligation (OSM attribution) and an *undecided* parameter (wedge
  length).
- Quality wishes resist "shall" until quantified: STK-011 ("don't overload the
  browser") could only be written as the testable SYS-004 (active-view-only);
  the underlying performance target remains TBD-007.
- Implied requirements are the dangerous ones: nobody wrote "streams stay live,"
  yet SYS-014 is clearly required — and is the one that fails. Eliciting implied
  requirements early is exactly what this reverse-engineering pass models.
