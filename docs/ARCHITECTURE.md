# Architecture

This repo is intentionally simple and file-based. Please keep it that way unless a documented decision changes it.

## High-level architecture

[ Frontend (static HTML) ]
        |
        v
[ Express server (`server.js`) ]
  - static hosting: `/` (from `frontend/`)
  - static data: `/json/*`, `/config/*`, `/api/*` (files)
  - helper endpoints:
    - `/api/market_history` (ESI history, cached on disk)
    - `/api/buy_orders` (ESI buy orders snapshot, cached in memory + disk)
    - `/api/lp_corp_index` (LP index series, cached on disk)
        |
        v
[ File data layer ]
  - `json/` (frontend-ready datasets)
  - `cache/` (heavy caches / snapshots + worker-only datasets)
  - `config/` (manual overrides / hide lists)

External sources:
- CCP SDE YAML (local files under `SDE/yaml/`)
- ESI (market endpoints)
- zKillboard (stats/history, optional WS)

## Responsibilities

### Frontend (`frontend/`)
- Pure rendering + client-side filtering/sorting
- Reads:
  - `/json/*.json` (prebuilt datasets)
  - `/api/*` (server helpers for charts / buy order snapshots)
- Must not directly call ESI / zKillboard.

### Server (`server.js`)
- Hosts static site and files
- Provides small, cache-friendly helper APIs for:
  - market history series
  - buy order snapshots
  - LP index series
- Contains no heavy ETL loops.

### Workers (`workers/`)
- Heavy data pulls and transformations
- Generate/refresh `json/*`
- Maintain `cache/*`
- Intended to run on a schedule (e.g., Windows Task Scheduler / cron)

Note:
- Only datasets that the frontend loads must live under `json/` (served as `/json/*`).
- Large “source/universe” datasets used only by workers should live under `cache/` (e.g. `cache/json/*`).

## Forbidden (by default)
- No business logic inside frontend pages beyond display/filters.
- No direct ESI / zKillboard calls from frontend.
- No “hidden” schema changes (update `docs/DATA.md`).
- No long-running cron-like loops inside `server.js`.
