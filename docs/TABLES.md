# Tables & Metrics Reference

This document is the source of truth for:
- every table/page in the UI
- all available columns (metrics) per table
- calculation formulas and assumptions

If you change a metric, rename a column, add/remove a field, or change filtering logic,
you MUST update this file in the same PR/commit.

## Conventions

### Regions / periods
- Default market region for pricing: **The Forge (10000002)**
- Periods used in UI and calculations:
  - **24h** (when available)
  - **7d**
  - **14d**
  - **30d**
  - **90d** (charts)

### Market prices
- **Market Price (Jita Sell)**: minimum sell price in the selected region (often The Forge/Jita).
- **Other Cost (Jita Sell)**: required items cost, priced using Jita sell price per required type.

### Quantity
- **Qty**: number of units received when buying the offer in the LP store.

### LP items vs offers
- **Item table** aggregates multiple corp offers for the same `itemId`.
- **Offer table** shows per-corporation (or per-offer) details.

---

## `lp.html` — LP Shop Corporations

**Purpose:** compare LP corporations by LP profitability and catalog structure.

**Data sources:**
- `json/lp_corps.json` (main table rows)
- `json/lp_corp_agents.json` (agents count + tags such as HS/LS/NS)
- `config/lp_corps_config.json` (hide flags / overrides)

**Row key:** `corpId`

### Available columns (Columns modal)

**Main**
- `#` — row number (UI only)
- `Corporation` — name + logo, links to `lp_corp.html?corp={corpId}`
- `Tags` — tag cloud (Empire/Pirate, HS/LS/NS, L5, etc.)

**Agents**
- `Agents` — total agents count (aggregated for the corporation)

**Economy**
- `Best ISK/LP` — best (max) `ISK/LP` among this corporation’s LP offers (after filters)
- `Median ISK/LP` — median `ISK/LP` across this corporation’s LP offers (after filters)

**LP**
- `Offers` — total offers count for this corporation
- `Unique items` — count of items that appear only in this corp (respecting hidden corp rules)

**IDs**
- `Corp ID` — corporation ID

### Formulas

**Best ISK/LP**
- `BestISkPerLP = max( offer.iskPerLp )` over filtered offers

**Median ISK/LP**
- `MedianISkPerLP = median( offer.iskPerLp )` over filtered offers

Notes:
- Filters (ISK/LP threshold, volume threshold, hidden corp rules) affect which offers are included.

---

## `lp_items.html` — LP Store Items

**Purpose:** browse all LP-store items and compare profitability and liquidity across LP stores.

**Data sources:**
- `json/lp_items.json` (item rows, aggregated)
- `config/lp_items_config.json` (hide flags / overrides)

**Row key:** `itemId`

### Available columns (Columns modal)

**Main**
- `#` — row number (UI only)
- `Item` — item icon + name, links to `lp_item.html?item={itemId}`
- `Category` — category/group label
- `Faction` — faction(s) where the item appears

**LP Metrics**
- `ISK/LP` — the selected profitability metric (typically median or best depending on UI mode)
- `LP Stores` — number of corporations that sell this item via LP
- `LP Capacity` — market capacity score (see formula below)
- `LP Weight` — LP weight % (see formula below)

**Market**
- `Price (Jita)` — Jita sell price (min sell in selected region)
- `Volume (Raw)` — average daily market volume (raw units/day) for selected period
- `Volume (Norm.)` — normalized by LP store quantity (see formula below)
- `Risk` — risk indicator (derived from liquidity/spread signals)

**LP Store**
- `Qty` — units received per LP-store purchase
- `ISK Cost (Store)` — ISK required in the LP store
- `Other Requirements` — list of required items (names × quantities)
- `Other Cost (Jita sell)` — priced sum of required items

**IDs**
- `Item ID` — type ID

### Formulas

**Other Cost (Jita sell)**
- `OtherCost = Σ( req.qty * req.sellPrice )`

**Net ISK (per offer)**
- `NetISK = (MarketPrice * Qty) - ISKCostStore - OtherCost`

**ISK/LP (per offer)**
- `ISKperLP = NetISK / LPCost`

**Volume (Raw)**
- `VolumeRaw = AvgDailyVolume(period)` from ESI history (units/day)

**Volume (Norm.)**
- `VolumeNorm = VolumeRaw / Qty`
  - Interpretation: how many LP-store purchases per day the market volume roughly represents.

**LP Capacity (LP liquidity score)**
- Definition (per item, for selected period):
  - `LP_liquidity_score = min(LP_spent_on_item, LP_equivalent_of_market_volume) / periodDays`

Implementation notes:
- `LP_equivalent_of_market_volume` is derived from market volume and a chosen reference LP value.
- This metric is meant as an “LP digestion capacity” signal, not an exact prediction.

**LP Weight % (current formula)**
- `LPWeightPct = (MarketPrice - ISKCostStore) / MarketPrice * 100`

---

## `lp_corp.html` — LP Corporation Card

**Purpose:** deep dive into one corporation’s LP store, agents, and LP value chart.

**Data sources:**
- `json/lp_offers.json` (offers for the corporation)
- `json/lp_corp_agents.json` (agent breakdown)
- `json/lp_corp_index/...` (LP value index chart bundle, optional on Pages)

### Blocks

1) **Header**
- corporation name + logo + faction pill(s) + tag cloud
- KPI cards (Best/Median ISK/LP, etc.) — derived from offers

2) **LP Value Chart**
- time series of LP value index (see formula below)

3) **Agents & LP Farming**
- HS/LS/NS segmented filter
- summary counts (Total agents, L4+ Security, difficulty)
- heatmap table by agent type × level
- insight line (potential)

4) **Corp Items table** (`corp_items`)
- per-offer rows (item + costs + requirements + market signals)
- shares the same filtering model as `lp_items.html` (volume/ISK-LP/columns)

### LP Index formula (chart)

For each day and each included item:

1) `ISK_per_LP_day = (SellPrice_day * Qty - ISK_cost - RequiredItemsCost) / LP_cost`

2) Fixed weight for the item within the selected basket:
- `Weight = AvgDailyVolume * ISK_per_LP_base`

3) LP Index for a day:
- `LP_Index_day = Σ( ISK_per_LP_day * Weight )`

Notes:
- Basket is “liquid items only” and is fixed for a period.
- Regions/period selection changes the underlying market history series.

---

## `lp_item.html` — LP Item Card

**Purpose:** deep dive into one LP item and compare corp offers.

**Data sources:**
- `json/lp_item_offers.json` (offers for the item)
- market history bundles (`json/market_history_...` on Pages or `/api/market_history` locally)

### Blocks

1) **Header**
- item name + icon + category/faction
- KPI cards: Sell (Jita), ISK/LP, LP Stores, LP Capacity, LP Weight

2) **Item chart**
- price or volume series (tabs) for 7d/30d/90d

3) **Offers table**
- rows: corporation offers for this item
- includes LP store costs and required items

### Formulas

Uses the same offer-level formulas as in `lp_items.html`:
- `OtherCost`, `NetISK`, `ISKperLP`, `LPWeightPct`, `VolumeRaw`, `VolumeNorm`

---

## `index.html` — System Stats

**Purpose:** browse solar systems with region, security status, kills/ISK destroyed and top corp/alliance.

**Data sources:**
- `json/system_table.json`
- zKillboard caches under `cache/zkb_*` (aggregated into `json/` datasets where applicable)

### Table columns (typical)
- `#` — row number
- `System`
- `Region`
- `Security`
- `Kills` (by selected period where available)
- `ISK Destroyed` (by selected period where available)
- `Top corporation` (+ alliance ticker if applicable)

---

## `map.html` — Map (if enabled)

**Purpose:** interactive map view (region selection, gates graph).

**Data sources:**
- `json/map_data.json`

---

## Notes / TODO

Some metrics may have multiple versions (e.g. risk, LP capacity) depending on ongoing tuning.
When you change any of them:
- update the formula section here
- update `docs/DATA.md` if the dataset shape changes

