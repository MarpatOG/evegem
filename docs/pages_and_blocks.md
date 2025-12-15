# Pages and blocks

This document describes what each page shows and which UI blocks it contains.

## `index.html` — System stats

- **Topbar / Navbar / Subnav**
  - Navigation across the project.
- **Controls bar**
  - Search.
  - Period switch (`7d` / `30d` / `ALL`).
  - Refresh button.
  - Columns (table columns picker).
- **Class filters**
  - HS/LS/NS/C1–C6 quick filters.
- **Systems table**
  - Main table with system metrics (kills/ISK, top corp/alliance).

## `lp.html` — LP Shop corporations

- **Topbar / Navbar / Subnav**
  - Navigation.
- **Controls bar**
  - Corporation name search.
  - Faction filter.
  - Numeric filters (best/median ISK/LP, unique items, offers).
  - Exclude CONCORD-only toggle.
  - Columns (table columns picker).
- **Corporations table**
  - List of LP corporations with aggregated LP performance.

## `lp_corp.html` — LP corporation card (`LP_corp`)

- **Topbar / Navbar / Subnav**
  - Navigation.
- **Corporation header**
  - Corporation name.
  - Corp logo.
  - Corp tags (e.g. Empire/Pirate, HS/LS/NS, FW, L5).
  - Corporation ID.
- **KPI tiles**
  - Best ISK/LP.
  - Median ISK/LP.
- **LP Value Chart**
  - LP Index over time (7d / 30d / 90d).
- **Agents & LP Farming**
  - HS/LS/NS toggles (filtering agent stats).
  - Summary KPIs (total agents, L4+ security agents, difficulty).
  - Heatmap table (agent type x level).
  - LP Farming Potential insight.
- **Corp offers table** (`corp_items`)
  - Filters: category, item name, ISK/LP, volume, LP max, sell min, unique-only, period.
  - Columns (table columns picker).
  - Table: offer rows for this corporation.

## `lp_items.html` — LP items table (`lp_items`)

- **Topbar / Navbar / Subnav**
  - Navigation.
- **Header controls**
  - Region pricing (currently fixed to The Forge).
  - Period switch (`24h` / `7d` / `30d`).
  - Category filter.
  - Faction filter.
  - Items count pill.
  - ISK/LP filter dropdown.
  - Volume filter dropdown.
  - Columns (table columns picker).
- **Items table**
  - Aggregated LP items (one row per `itemId`).
  - Optional columns (via Columns) include store/requirements fields.

## `lp_item.html` — LP item card

- **Topbar / Navbar / Subnav**
  - Navigation.
- **Item header**
  - Item icon, name, ID.
  - Category + faction tags.
- **KPI tiles**
  - Sell (Jita).
  - ISK/LP.
  - LP Stores.
  - LP Capacity.
  - LP Weight.
- **Instant Sell (Buy Orders)**
  - “Sell quantity” / “Sell above price” modes.
  - Inputs: quantity, offset from best buy.
  - Outputs: units, avg price, total ISK, orders consumed, lowest price, price floor.
  - Disclaimer.
- **Market chart**
  - Price/Volume chart (7d / 30d / 90d).
  - % change badges.
- **Available in LP stores table**
  - Offer list across corporations for this item.
  - Columns (table columns picker).

## `map.html` — Map (currently not used)

- **Map view**
  - Experimental universe/region map page (may be disabled/unused in current UX).

