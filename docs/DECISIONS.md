# Decisions log

Keep short entries. Each entry should state what we decided and why, so we don’t revisit the same debate repeatedly.

## 2025-12 — File-based architecture (no DB)
Decision:
- Keep the project file-based (`json/` + `cache/` + `config/`) without PostgreSQL/Redis.

Why:
- Faster iteration and simpler deployment.
- Works well with “build locally → publish JSON” workflow.

## 2025-12 — ISK/LP includes LP store quantity
Decision:
- ISK/LP is computed using the revenue for the actual store output quantity (`qty`).

Rationale:
- Many LP offers return multiple units (e.g., ammo stacks). Ignoring `qty` inflates/deflates profitability.

## 2025-12 — Volume normalization
Decision:
- Provide `Volume (Norm.) = Volume (Raw) / bestQty` for items.

Rationale:
- Raw market volume is in units traded; normalizing by store quantity helps compare items fairly.

## 2025-12 — LP Weight definition (v2)
Decision:
- LP Weight % = `(Market Price − ISK Cost in LP Store) / Market Price × 100`.

Rationale:
- Interpretable “how much of market price is not the ISK store component”.

## 2025-12 — Hide configs affect aggregations
Decision:
- Hidden corps/items (via `config/*.json`) must be excluded from metrics/aggregations, not only hidden in UI.

Rationale:
- Prevents hidden entities from skewing rankings and medians.

