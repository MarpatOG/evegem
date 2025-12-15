# Data & Cache Reference

This document describes:
- external APIs we rely on
- local datasets under `json/`
- caches/snapshots under `cache/`
- config files under `config/`

If you change a dataset shape or meaning, update this file.

## External APIs

### ESI (EVE Swagger Interface)

Used for market pricing / liquidity and charts.

- `GET /markets/{region_id}/orders/`
  - used for: buy-order snapshot (`/api/buy_orders`)
  - cache: in-memory TTL 5 minutes + on-disk snapshot in `cache/`
  - notes: paginated; may be incomplete during downtime

- `GET /markets/{region_id}/history/?type_id=...`
  - used for: price/volume history charts (`/api/market_history`) and LP index
  - cache: on disk in `cache/esi_history/{region}/{type}.json`
  - notes: history is sparse (days with no trades may be missing)

### zKillboard

Used for killboard analytics and system/region activity.

- Statistics endpoints
  - used for: all-time baseline and periodic summaries
  - stored in `cache/zkb_*` and merged into `json/zkb_*`

- History endpoint
  - example: `https://zkillboard.com/api/history/YYYYMMDD.json`
  - used for: daily backfills / deltas

## Generated datasets (`json/`)

Эти файлы — контракт между воркерами и фронтом: UI загружает их через `/json/*`.

### `json/lp_items.json`
Aggregated view: one row per LP item (best/median across LP stores).

Shape:
- `{ items: Array<...> }`

Key fields (non-exhaustive):
- `itemId`, `itemName`
- `category`, `group`
- `lpStores` (count), `factions` (string[])
- `sellPrice` (Jita sell snapshot)
- `bestQty`, `bestIskCost`, `bestOtherCost`, `bestOtherRequirements`
- `bestIskPerLp`, `medianIskPerLp`
- `volumePerDay{1,7,14,30}` (raw market volume/day)
- `lpCapacity{1,7,30}`
- `lpWeightPct`
- `risk14`, `risk30`

### `json/lp_corps.json`
Aggregated view: one row per LP corporation.

Shape:
- `{ corps: Array<...> }`

Key fields:
- `corpId`, `name`, `factionId`, `faction`, `type`, `logoId`
- `lpStoreCount` (offers count), `uniqueCount`
- `bestIskPerLp`, `medianIskPerLp`
- `medianTTS`, `capitalBand`

### `json/lp_offers.json`
Offers grouped by corporation (corp card uses this).

Shape:
- `{ [corpId: string]: Array<Offer> }`

Offer fields (typical):
- `itemId`, `itemName`, `qty`
- `lpCost`, `iskCost`
- `requiredItems` (array of `{ typeId, name, qty }`)
- derived metrics: `iskPerLp`, `sellPrice`, `volumePerDay*`, `risk*`, etc.

### `json/lp_item_offers.json`
Offers grouped by item (item card uses this).

Shape:
- `{ [itemId: string]: Array<Offer> }`

### `json/lp_corp_agents.json`
Agent summary per corp (used on `lp_corp.html`).

Shape:
- `{ corps: Array<...> }`

### `json/market_history_10000002_90d.json` (Pages export)
Prebuilt market history bundle for GitHub Pages (no `/api/market_history`).

Shape:
- `{ regionId, days, updated, source, seriesByType: { [typeId]: Array<{date, average, volume}> } }`

Used by:
- `frontend/lp_item.html` (price/volume chart, 7d/30d/90d views).

Notes:
- Built from `cache/esi_history/{regionId}/{typeId}.json`.
- Only includes types present in `json/lp_items.json`.

### Universe / SDE-derived datasets

Фронту нужны только:
- `json/system_table.json` (System stats page)
- `json/map_data.json` (Map page)

Остальные “universe dumps” (systems/regions/gates/etc.) используются воркерами как исходники и лежат в `cache/json/*` (не часть фронтового контракта).

### Killboard / zKillboard data

На текущем этапе killboard-джобы используют локальные файлы/кэши. Большие промежуточные выходы также хранятся в `cache/` и не считаются фронтовым контрактом, пока UI их явно не загружает из `/json/*`.

## GitHub Pages exports

Это статические датасеты, которые заменяют `/api/*` на Pages:

- `json/market_history_10000002_90d.json` (см. выше)
- `json/lp_corp_index/10000002/{corpId}_90_25.json`
  - used by: `frontend/lp_corp.html`
  - built by: `workers/pages_build_lp_corp_index.js`

## Caches & snapshots (`cache/`)

### Market history cache
- `cache/esi_history/{regionId}/{typeId}.json`

### LP index cache
- `cache/lp_index/{regionId}/{corpId}_{days}_{limit}.json`
- produced by `GET /api/lp_corp_index`
- TTL: ~6 hours

### Buy orders snapshot cache
- cached in-memory for 5 minutes (see `BUY_ORDERS_TTL_MS` in `server.js`)
- persisted snapshots live under `cache/` (see `server.js` paths)

### zKillboard caches
- `cache/zkb_*` directories and JSON files produced by workers
- merged outputs land in `json/zkb_*`

## Config files (`config/`)

### `config/lp_corps_config.json`
Per-corporation overrides.
- `hide: true` hides corp from UI and removes it from aggregations where applicable.

### `config/lp_items_config.json`
Per-item overrides.
- `hide: true` hides item from UI and excludes it from LP calculations and indices.
