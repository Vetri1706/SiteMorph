<p align="center">
  <img src="public/sitemorph-logo-512.png" alt="SiteMorph logo" width="112" />
</p>

<h1 align="center">SiteMorph</h1>

<p align="center">
  <strong>Historical climate evidence translated into native Autodesk Forma design action.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-18a999.svg" /></a>
  <img alt="Project status: advanced prototype" src="https://img.shields.io/badge/status-advanced%20prototype-0b2740.svg" />
  <img alt="Autodesk Forma extension" src="https://img.shields.io/badge/Autodesk%20Forma-extension-149eca.svg" />
  <img alt="FortyGuard historical evidence" src="https://img.shields.io/badge/FortyGuard-historical%20evidence-18a999.svg" />
  <img alt="No runtime LLM required" src="https://img.shields.io/badge/runtime%20LLM-not%20required-0b2740.svg" />
</p>

SiteMorph is a climate-to-design decision engine embedded in Autodesk Forma. It turns a selected Site Limit into traceable **Climate DNA**, a requirements-driven native Forma building or residential subdivision, a measured native-analysis result, and an audit-ready Word report. **FortyGuard adds historical thermal context to Forma; Forma supplies native geometry and design-performance analysis.**

The current release is an advanced prototype built with production-minded provenance, credit controls, persistent recovery, fail-closed validation, and explicit limitations. Its decision engine is deterministic and auditable—no paid GPT or other runtime LLM is required.

## Install SiteMorph in Autodesk Forma

[**Install SiteMorph in Autodesk Forma**](https://app.autodeskforma.com/extensions/extension/bde7a190-46a3-4d63-9768-878e7f49828e)

1. Sign in to Autodesk Forma.
2. Select the **Region**, **Hub**, and **Project** where SiteMorph should be installed.
3. Install SiteMorph into that project.
4. Open the project, open **Extensions**, and launch **SiteMorph**.

**Installation is project-specific.** Repeat the installation for another project when needed.

The extension is currently **not listed and shared privately**. This means it does not appear in the public Autodesk Marketplace, but anyone with the direct link and appropriate Forma access can install it into a project they can use.

![A real Forma Site Limit becomes multi-year SiteMorph Climate DNA](docs/media/sitemorph-site-to-climate.gif)

## Why SiteMorph

Early site design often separates historical climate evidence from the geometry that will actually be analyzed and handed downstream. SiteMorph closes that gap inside Forma:

- uses the selected Forma Site Limit as the real analysis boundary;
- preserves FortyGuard's coarse historical resolution instead of inventing parcel detail;
- translates evidence into a preliminary, editable project brief;
- creates terrain-aligned native Forma geometry—not an independent 3D viewer;
- tests at most one explainable change with native analysis and retains the better-supported result;
- records inputs, source labels, analysis identifiers, decisions, and limitations in a genuine DOCX report.

## How to use SiteMorph

1. **Open SiteMorph inside the Forma project.** The extension starts without assuming a site or reusing geometry from another project.
2. **Choose Select Site Limit, then select a real Site Limit on the Forma canvas.** SiteMorph reads that element's polygon, area, projection, project context, and terrain.
3. **Restore or analyze Climate DNA.** SiteMorph checks saved evidence first. A new uncached site requires one explicit confirmation before any FortyGuard activity is submitted.
4. **Review the full climate context.** Inspect hot-season temperature, persistence, threshold exceedance, peak thermal time, spatial confidence, environmental context, and the visible satellite source or segmentation image.
5. **Read the Climate Design Brief.** LOW spatial confidence produces site-wide heat constraints—never a fabricated hot or cool side of the parcel.
6. **Choose a design path.** Use **Single building** for a requirements-driven Forma mass or **Residential subdivision** for explicit lots, roads, open space, canopy, parking, and separate dwellings.
7. **Generate in Forma.** SiteMorph writes terrain-aligned native Forma floor stacks. Subdivision roads, paths, open-space shapes, lots, and recognizable trees remain clearly labelled preliminary context.
8. **Validate the proposal.** SiteMorph uses native Forma Sun and, when available, Rapid Wind results, and refuses to invent metrics when Forma does not expose a readable grid.
9. **Download the Site Intelligence & Climate Design Report.** The Word report records evidence, assumptions, activity IDs, selected geometry, validation, limitations, and the final recommendation.
10. **Continue to Revit when ready.** Use Forma's supported **Proposals → Revit → Send to Revit add-in (Beta)** workflow for the persisted native proposal.

### First analysis, reopen, and retry behavior

- A new uncached Site Limit can use up to **15 FortyGuard activities** after confirmation: 12 thermal activities plus environmental parameters, satellite context, and street-edge context.
- A completed first analysis must contain a usable satellite source or segmentation image. Missing satellite imagery is an attention state, not a successful Climate DNA result.
- An older thermal-only saved result reuses its 12 thermal activities and requests only the 3 missing context activities after confirmation.
- Reopening, refreshing, or retrying the same completed Site Limit restores the saved result and submits **zero new activities**.
- Selecting a different Site Limit re-reads the actual geometry and project context before any cache lookup.

### From climate brief to native Forma geometry

![SiteMorph applies an evidence-based brief and generates a native Forma floor stack](docs/media/sitemorph-brief-to-building.gif)

The current Site Fit Advisor covers eight development-use families: logistics, multifamily, office/R&D, healthcare, education, hotel, retail, and mixed use. Suggestions remain preliminary until zoning, access, utilities, market, entitlement, fire, and parking-code evidence is connected or confirmed by the user.

## FortyGuard capabilities used by SiteMorph

FortyGuard is not a badge or a single temperature card in SiteMorph. Its historical evidence is the input backbone for Climate DNA, the Climate Design Brief, spatial-confidence decisions, and the FortyGuard-adjusted climate-resilience component that contributes 50% of residential-subdivision ranking. SiteMorph uses the following FortyGuard capabilities deliberately:

| FortyGuard evidence | What the user sees | How SiteMorph uses it |
| --- | --- | --- |
| **Hot-season temperature / TCM** | Historical temperature evidence in °C across three representative July dates (2023–2025 by default), with native resolution | Establishes baseline thermal exposure and contributes to relative tile ranking and historical heat burden |
| **Continuous heat persistence** | Mean persistence and maximum continuous persistence shown as distinct statistics | Identifies heat that remains for long periods instead of treating a brief peak as equivalent to sustained exposure |
| **Threshold exceedance** | Mean hours above the configured threshold, normally 35 °C for this workflow, across the sampled daily outputs | Quantifies repeated severe heat without mislabelling the value as a seasonal-hour total |
| **Peak thermal time (`time_of_measure`)** | The modal provider-returned peak hour across the sampled tiles and dates, presented in the site's local time with UTC retained as secondary evidence | Provides day-versus-evening heat-retention context; availability never increases the numerical burden score |
| **Native polygon tiles** | Real provider cells intersecting the selected Forma Site Limit; parcel-edge gaps use the nearest real cell value | Supports relative within-site comparison only when the cells show meaningful separation; SiteMorph never invents finer variation |
| **Satellite source and surface segmentation** | A visible source or segmented image plus returned tree, vegetation, grass, building, road, pavement, bare-ground, and other shares | Grounds the first full analysis in real visual context; the run fails closed when neither usable image is returned |
| **Environmental parameters** | Humidity, heat index, apparent and wet-bulb temperature, cloud cover, precipitation, elevation, AQI, and GHI/DNI/DHI when returned | Supports interpretation with explicit provenance and availability, without silently turning every field into a thermal-risk score |
| **Street-edge source and segmentation** | One sampled northern access-edge view with returned tree, sky, building, road, sidewalk, and earth shares, or an explicit unavailable state | Adds limited edge context; displayed openness remains a segmentation proxy, not a claimed Sky View Factor or full perimeter survey |
| **Activity status and identifiers** | Provider activity IDs, completion state, dates, resolution, timezone, and source labels in the evidence trail | Makes interruption recovery, audit, report generation, and cache-safe reuse possible |

### What SiteMorph derives from FortyGuard

- **Climate DNA:** a normalized, source-labelled summary of temperature, persistence, exceedance, peak timing, tile evidence, imagery, confidence, and limitations.
- **Thermal-zoning confidence:** meaningful real-cell separation permits relative ranking; uniform evidence keeps every tile **Moderate**, produces **LOW** confidence, and creates no compass-direction recommendation.
- **Relative historical thermal tile ranking:** 40% lower mean temperature, 35% lower persistence, and 25% lower exceedance. This is used only when the real FortyGuard tiles support a comparison.
- **Historical subdivision burden:** 35% temperature, 25% mean persistence, 20% maximum continuous persistence, and 20% mean exceedance through an exposed weighted geometric mean.
- **Climate-first option ranking:** FortyGuard-adjusted climate resilience contributes **50%** of the final subdivision score before yield, lot match, open-land delivery, and native-Forma simplicity.
- **Forma-resolved Climate Response:** when all three inputs are readable, FortyGuard is the 45% site-wide historical baseline; finer spatial variation comes only from native Forma Sun and Rapid Wind grids, with weights renormalized across available real inputs.
- **Traceable design response:** cooling resilience and impervious-surface-reduction priorities remain linked to historical evidence. Canopy targets, spacing, massing, shaded movement, and open-land values stay visible as SiteMorph or user-confirmed planning assumptions.

Satellite imagery, peak-time availability, and evidence completeness are context—not hidden numerical bonuses. Environmental or street evidence contributes only when it is actually returned. When FortyGuard cannot reliably separate a parcel at its native resolution, SiteMorph says so and lets Forma resolve internal placement through native design analysis.

## Residential subdivision workflow

Residential Subdivision mode is a first-class deterministic workflow, not a handoff to a third-party geometry generator. It uses the real Forma Site Limit, saved Climate DNA, and explicit user-confirmed planning assumptions to preview three auditable strategies:

- **Compact yield** prioritizes dwelling count with the tightest spacing, no carved heat-relief corridor, and a reduced concept-canopy target.
- **Balanced neighborhood** adds perimeter spacing, a shared-green corridor, shaded pedestrian routes, and a stronger canopy response while preserving useful yield.
- **Heat-resilient neighborhood** uses the largest perimeter allowance, two heat-relief corridors, the strongest shade and dwelling-spacing mitigation, and aims to deliver the full concept-canopy target.

The generator does not infer zoning, setbacks, density, parking compliance, fire access, utilities, grading, drainage, entitlement, or planting requirements. Those values remain visible user inputs or SiteMorph assumptions with provenance and warnings.

### FortyGuard is half of every subdivision decision

Option generation reuses the already restored or completed Climate DNA. It submits **zero new paid FortyGuard activities**. The same real hot-season evidence is applied consistently to every strategy, and uniform or LOW-confidence FortyGuard data produces a site-wide response with no invented directional cool zone.

SiteMorph first calculates a four-signal FortyGuard historical burden as a weighted geometric mean:

```text
T = clamp((hot-season mean temperature °C - 20) / 25, 0, 1)
Pm = clamp(mean continuous persistence hours / 24, 0, 1)
Px = clamp(maximum continuous persistence hours / 24, 0, 1)
E = clamp(mean exceedance hours above the recorded threshold / 24, 0, 1)
FortyGuard burden B = geometricMean(T @ 35%, Pm @ 25%, Px @ 20%, E @ 20%)
```

Inputs to the logarithmic mean are bounded to `0.02–1.00` for numerical stability. Temperature, mean persistence, maximum continuous persistence, and mean exceedance are the only numerical risk inputs. The actual FortyGuard peak thermal hour is shown separately as supporting evidence and evidence-completeness context; its availability never increases or decreases heat burden.

Each plan then exposes a second multiplicative step:

```text
Mitigation multiplier M = geometricMean(
  canopy risk multiplier @ 35%,
  pedestrian-route shade multiplier @ 30%,
  open-land risk multiplier @ 20%,
  dwelling-spacing multiplier @ 15%
)

Residual heat risk = B × M
Climate resilience = 1 - residual heat risk
```

Canopy and open-land multipliers are derived from the option's delivered concept quantities against the explicit targets; shade and spacing multipliers are fixed, visible properties of the selected deterministic strategy. They are mitigation assumptions, not measured cooling performance.

The final option score keeps FortyGuard structurally central:

```text
50% FortyGuard-adjusted climate resilience
+ 20% development yield
+ 15% requested-lot match
+ 10% open-land delivery
+  5% native-Forma delivery simplicity
```

### Selected-only native delivery

All three alternatives remain local previews until the user chooses one. SiteMorph then creates only that option's dwellings with Forma's batch floor-stack API, using a separate tracked native element for every dwelling. Before accepting the run, it samples terrain beneath the footprints and verifies persisted names, SiteMorph ownership metadata, transforms, meshes, footprint containment, and terrain placement. A failed run is rolled back; earlier SiteMorph-owned roots are removed only after the replacement has persisted and passed verification.

The complete verified proposal receives one native Forma Sun analysis over the selected Site Limit. If Forma completes the job without exposing a readable ground grid, SiteMorph records `native-result-only` rather than inventing metrics. The selected plan also receives one refresh-safe virtual SiteMorph context root: roads, pedestrian paths, lot/open-space terrain shapes, and recognizable species-neutral low-poly trees at real sampled terrain elevations. The clean-room tree asset is serialized as standards-compliant glTF Y-up geometry, then SiteMorph verifies its world-space terrain base, height, canopy span, and upright orientation after Forma persists it. Those persistent custom Forma elements remain preliminary planning context and are excluded from physical analysis; the separate dwelling floor stacks remain the native design and Revit-transfer geometry. A transient ground texture is used only for labels.

The DOCX report can record the selected strategy, four weighted FortyGuard risk inputs, peak-time supporting evidence, formulas, option score, assumptions, warnings, terrain-verification counts, analysis identifier/status, and available Forma capture. The optional subdivision evidence JSON additionally preserves the tracked native element paths. For Revit, only the persisted native Forma dwelling floor stacks can follow **Proposals → Revit → Send to Revit add-in (Beta)**. SiteMorph does not claim that concept lots, roads, trees, labels, rooms, walls, roofs, openings, or custom metadata transfer as native BIM.

The deterministic generator and Forma service are covered by automated tests. A clean live multi-building Forma-to-Revit round trip has not yet been verified, so neither the product nor this README claims one.

### One measured design decision

![SiteMorph runs native Forma analysis and retains the better-supported design](docs/media/sitemorph-measured-design-loop.gif)

SiteMorph does not call an intervention successful merely because an analysis finished. Implausible values, unreadable grids, or unsupported improvements are rejected or degraded explicitly; the initial geometry is restored when the tested change is not defensible.

## What is real, derived, and preliminary

| Layer | Owner | What SiteMorph uses it for |
| --- | --- | --- |
| Site Limit, projection, terrain, proposal elements | Autodesk Forma | AOI geometry, native floor stack placement, persistence, and downstream handoff |
| TCM/temperature, persistence, exceedance, peak time | FortyGuard | Multi-date historical hot-season evidence at the provider's native resolution |
| Sun and Rapid Wind grids | Autodesk Forma | Design-scale validation when the embedded SDK exposes readable results |
| Climate DNA, Site Fit ranking, subdivision ranking, program plan, decision log | SiteMorph | Deterministic translation, scoring, constraints, and audit trail |
| Subdivision lots, roads, open space, and trees | SiteMorph | Persistent virtual Forma concept elements after build; not surveyed civil geometry, planting design, verified BIM, or code compliance |
| Archived South Phoenix imagery | Third-party source evidence | Clearly dated supporting context; never represented as current-run thermal evidence |

## Key capabilities

- **Climate DNA:** multi-year hot-season evidence, explicit source labels, low-confidence handling, and clipped native-ground overlays.
- **Credit-safe full evidence:** cache-first requests, a 15-activity first-run ceiling, persisted activity IDs, resumable polling, ordered server-only fallback keys, required satellite context, and zero-activity same-AOI reruns.
- **Site Fit Advisor:** input-specific deterministic briefs with visible assumptions and missing-evidence warnings.
- **FortyGuard-weighted subdivisions:** three deterministic strategies, exposed multiplicative heat-risk scoring, selected-only native dwelling delivery, refresh-safe concept roads/greens/3D trees, and zero additional paid activities for option generation.
- **Typology-aware planning:** program zones, parking, access, sheltered arrival/loading/service edges, and unallocated landscape.
- **Native Forma design loop:** terrain-safe floor stacks, footprint-conflict checks, Sun validation, optional Rapid Wind, and one measured revision.
- **Honest Revit handoff:** proposal preflight and native Forma-to-Revit guidance without calling JSON or OBJ native BIM.
- **Auditable exports:** genuine DOCX reporting plus optional CSV/JSON evidence exports.

## Architecture

<p align="center">
  <a href="docs/media/sitemorph-system-architecture-4k.png">
    <img src="docs/media/sitemorph-system-architecture-4k.png" alt="SiteMorph architecture showing Autodesk Forma, the embedded React extension, cache-first server orchestration, every FortyGuard activity route, Climate DNA normalization, deterministic design branches, native Forma validation, reporting, Revit handoff, and functional and non-functional requirements" width="100%" />
  </a>
</p>

<p align="center"><sub><strong>SiteMorph end-to-end architecture.</strong> Click the diagram for the full 3840 × 2160 version. The editable vector source is available at <a href="docs/media/sitemorph-system-architecture.svg">docs/media/sitemorph-system-architecture.svg</a>.</sub></p>

The diagram distinguishes implemented solid routes from conditional or user-driven dashed routes. FortyGuard remains the historical-evidence system; Autodesk Forma remains authoritative for site geometry, terrain, native proposal elements and design-scale analysis; SiteMorph owns orchestration, deterministic decisions, validation and traceability.

<details>
<summary><strong>Technical routes and implemented requirements</strong></summary>

### Runtime routes

| Boundary | Method and route | Purpose |
| --- | --- | --- |
| Embedded panel → SiteMorph | `POST /api/site/analyze` | Cache-first restore or analysis for a GeoJSON Site Limit, 35 °C threshold, site timezone and `cacheOnly` state |
| Embedded panel → local SiteMorph | `GET /api/fortyguard/usage` | Retrieves or restores a dated server-side credit snapshot; deliberately disabled on the public hosted worker |
| SiteMorph → FortyGuard | `POST /v1/heatmap` | Creates one core activity for each date and analytic type: `tcm`, `persistence`, `exceedance`, or `time_of_measure` |
| SiteMorph → FortyGuard | `GET /v1/status/:activityId` | Resumes and polls the exact persisted activity ID without resubmitting it |
| SiteMorph → FortyGuard | `POST /v1/env_params`, `/v1/satellite`, `/v1/streetview` | Three full-run context activities after explicit approval; satellite imagery is completion-critical, while environmental and street results degrade explicitly when unavailable |
| SiteMorph → FortyGuard | `POST /v1/system/fetch-api-key-usage` | Server-only usage lookup; the browser never receives an API key |

### Functional and non-functional requirements

| Type | Requirement | Implemented behavior |
| --- | --- | --- |
| Functional | Real Forma AOI | Accepts a selected Site Limit element path, validates its footprint and converts project coordinates into a closed WGS84 Polygon |
| Functional | Historical Climate DNA | Restores or creates multi-date temperature, persistence, exceedance and peak-time evidence plus required first-run satellite context, with source, activity-ID, timezone and resolution provenance |
| Functional | Honest spatial display | Clips the ground texture to the complete Site Limit, extends only the nearest real edge value and never invents parcel-scale variation |
| Functional | Deterministic design | Produces preliminary Site Fit briefs, a typology-aware single-building loop, or three auditable subdivision strategies with explicit assumptions and formulas |
| Functional | Forma-native delivery | Creates terrain-aligned native floor stacks, materializes only the selected subdivision, verifies placement and persists preliminary concept context separately |
| Functional | Measured decision | Runs native Site-Limit Sun and optional Rapid Wind, tests at most one explainable revision and retains it only when readable metrics support improvement |
| Functional | Trace and handoff | Exports genuine DOCX and evidence sidecars, preflights the persisted proposal and guides the supported Forma → Revit add-in workflow |
| Non-functional | Deterministic and auditable | Requires no runtime LLM; formulas, provenance, IDs, timestamps, decisions and limitations remain inspectable |
| Non-functional | Secure and credit-safe | Keeps keys server-side, uses strict ordered failover, caps the approved full first run at 15 and reuses the same canonical full-evidence AOI with zero new activities |
| Non-functional | Durable and recoverable | Persists activity IDs immediately, resumes polling, coalesces in-flight requests and survives process restarts through local or hosted storage |
| Non-functional | Fail-closed integrity | Rejects malformed geometry, empty thermal coverage, missing required first-run satellite imagery, implausible Sun values, unreadable grids and displaced geometry instead of manufacturing a recommendation |
| Non-functional | Bounded operation | Caps polling, retries, concurrency, request size, terrain sampling and geometry work; hosted analysis also uses origin, lock and quota guards |
| Non-functional | Host-native interoperability | Treats Forma as the geometry/analysis authority, keeps Revit transfer user-driven and never claims concept overlays or JSON are native BIM |

</details>

## Privacy, credits, and saved evidence

- FortyGuard credentials and fallback keys remain server-side. They are never delivered to the browser or exposed in an exported report.
- SiteMorph checks the saved canonical Site Limit result before requesting anything new. Equivalent polygon winding or rotation does not create a second paid analysis.
- Activity IDs are saved immediately. Interrupted analyses resume polling the same activities instead of submitting replacements.
- Credential fallback follows the configured server-side order and occurs only after a definitive invalid, revoked, or exhausted-credit response—never after an ambiguous network failure.
- The guarded hosted workflow has a persistent lifetime ceiling of 15 new activities for the approved full-evidence AOI. A concurrent retry cannot reserve a second allowance.
- A result is not marked complete when thermal coverage is empty, required satellite imagery is missing, or provider output is malformed. SiteMorph keeps the evidence state and explains what is unavailable.
- Downloaded reports contain evidence provenance and analysis identifiers, but never FortyGuard API credentials or Autodesk secrets.

## Revit handoff

SiteMorph persists and verifies its native Forma proposal element or selected subdivision dwelling elements. The user then completes the supported host workflow through **Proposals → Revit → Send to Revit add-in (Beta)**. The public embedded-view SDK does not expose a trigger for that host menu.

The transferable artifacts are the native Forma mass/floor stack and, for a materialized subdivision, the separate native Forma dwelling floor stacks. SiteMorph's program labels remain report/evidence data. Built subdivisions also contain persistent virtual road/green terrain shapes and low-poly tree instances inside Forma, but SiteMorph does not claim that they become Revit Roads, Toposolids, Planting families, Rooms, or parameters. JSON and OBJ exports are optional audit/reference files, not BIM synchronization. A clean multi-building subdivision round trip remains explicitly unverified.

## Known limitations

- Site Fit results are not zoning, entitlement, legal, financial, market, fire, parking-code, civil, or structural advice.
- FortyGuard historical layers may be spatially uniform at 60 m resolution; SiteMorph reports low zoning confidence instead of inventing a preferred direction.
- If completed saved activities return an empty polygon FeatureCollection, SiteMorph records a terminal no-coverage result, preserves the activity IDs, skips dependent metrics, and does not resubmit or invent Climate DNA.
- A first uncached full-evidence run is not considered complete without usable FortyGuard satellite source/segmentation imagery. SiteMorph preserves submitted activity IDs and surfaces an attention state rather than silently falling back; saved matching imagery can be restored with zero new activities.
- Forma may complete an analysis without exposing a readable ground grid. SiteMorph records native-result-only or partial status rather than fabricating metrics.
- The Compare tab remains a precomputed demo workflow. Residential Subdivision mode separately generates three deterministic local previews and writes only the selected option; it does not imply three live Forma analyses.
- The generated object is concept-stage mass/floor geometry, not detailed walls, roofs, openings, systems, or construction documentation.
- Built subdivision lot lines, roads, paths, open space, and trees are persistent virtual concept elements, not surveyed alignments, grading, code-compliant access, species selections, planting design, or validated BIM. Before build, they are local previews only.
- Revit transfer is completed through Autodesk's add-in UI; SiteMorph cannot invoke it programmatically.
- There is no runtime GPT/LLM dependency; SiteMorph's live decisions are deterministic and inspectable.

## License

SiteMorph-authored source code and documentation are available under the [MIT License](LICENSE). Copyright © 2026 Vetri Kalanjiyam.

Third-party product screenshots, trademarks, basemap attribution, archived evidence, and provider output remain subject to their respective owners' terms and are not relicensed by MIT. See [Third-Party Notices](THIRD_PARTY_NOTICES.md).

## Acknowledgements

- **Autodesk Forma** supplies the native site, geometry, proposal, Sun, Wind, and Revit-handoff environment.
- **FortyGuard** supplies historical thermal context used by Climate DNA.
- Basemap and captured source attribution remains visible in the relevant evidence and screenshots.

SiteMorph is an independent prototype and is not endorsed by Autodesk or FortyGuard. Autodesk, Forma, Revit, FortyGuard, and other names and marks belong to their respective owners.
