# SiteMorph

Climate-aware design intelligence for Autodesk Forma. This frontend is a Vite + React + TypeScript embedded-view extension optimized for a 360–480 px right-side panel.

## Run locally

```bash
npm install
npm run dev
```

Live embedded mode is enabled in `.env`:

```env
VITE_MOCK_MODE=false
VITE_SITEMORPH_BACKEND_URL=/api
```

The browser environment may contain only public configuration. Never add a FortyGuard API key, Autodesk client secret, or backend credential to a `VITE_*` variable.

## Architecture

- `src/services/forma.service.ts` initializes `Forma` from `forma-embedded-view-sdk/auto`, reads the selected Site Limit footprint, and converts project coordinates to a closed WGS84 GeoJSON polygon.
- `POST /api/site/analyze` is implemented by the local Vite backend middleware. It submits only FortyGuard TCM, persistence, and exceedance jobs and keeps `FORTYGUARD_API_KEY` server-only.
- `src/services/overlay.service.ts` converts returned FortyGuard `map_data` tiles back into Forma project coordinates and renders a per-tile thermal color mesh through `Forma.render.addMesh`.
- `src/services/design.service.ts` consumes external design IDs; it does not invent geometry in the browser.
- `src/services/analysis.service.ts` normalizes Forma-native validation metrics.
- `src/stores/useSiteMorphStore.ts` orchestrates the demo flow without persisting secrets or analysis payloads to local storage.

## Core live backend route

```text
POST /api/site/analyze
```

The route accepts `{ geometry, thresholdCelsius }`, where `geometry` is the selected Forma Site Limit as WGS84 GeoJSON. It returns normalized Climate DNA plus the real FortyGuard `map_data` for temperature, persistence, and exceedance.

Server-only configuration:

```env
FORTYGUARD_API_KEY=...
FORTYGUARD_API_URL=https://api.fortyguard.com/v1
FORTYGUARD_ANALYSIS_DATE=2024-07-15
FORTYGUARD_GRANULARITY=60
FORTYGUARD_CACHE_VERSION=v1
```

Completed live analyses are stored under `.sitemorph-cache/fortyguard/`. The cache key includes the canonical Site Limit polygon, representative dates, threshold, granularity, timezone, and cache version. Restarting SiteMorph or reloading the same AOI reuses the saved result without another FortyGuard analysis request. Change `FORTYGUARD_CACHE_VERSION` only when an intentional paid refresh is required.

## Verification

```bash
npm run typecheck
npm run build
npm run test:sites
```

Mock data lives only in `src/mocks/` and is labeled as demo data in the interface.
