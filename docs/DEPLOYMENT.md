# Деплой на GitHub Pages (пайплайн ПК → Pages)

Цель: воркеры и тяжёлая база остаются на ПК, а GitHub Pages хостит статический сайт (`frontend/*`) + готовые JSON (`json/*`).

## Важное ограничение GitHub Pages
GitHub Pages не запускает Node/Express, поэтому **любой доступ к `/api/*` на Pages не работает**.

Также важно: Pages обычно публикует сайт не в корне домена, а по пути вида `https://{user}.github.io/{repo}/`.
Поэтому фронт **не должен** делать запросы к абсолютным путям вида `/json/...` и `/config/...` — это будет уходить на корень домена и давать 404.
Используем относительные URL (`json/...`, `config/...`) или `new URL("json/...", location.href)`.

На текущем фронте есть зависимости от `/api/*`:
- `frontend/lp_item.html`
  - `/api/buy_orders` (Instant Sell / buy orders snapshot)
  - `/api/market_history` (график цены/объёма)
- `frontend/lp_corp.html`
  - `/api/lp_corp_index` (LP Value Chart)

Чтобы Pages работал, эти данные должны быть **предрасчитаны воркерами в `json/*`** и читаться фронтом как файлы.

## Рекомендуемая схема данных для Pages

### 1) Market history (замена `/api/market_history`)
Сгенерировать:
- `json/market_history_10000002_90d.json`

Формат:
```json
{
  "regionId": 10000002,
  "days": 90,
  "updated": "2025-12-16T00:00:00Z",
  "source": "cache/esi_history",
  "seriesByType": {
    "34": [ { "date": "2025-12-01", "average": 123.4, "volume": 5678 }, ... ]
  }
}
```

Фронт: `frontend/lp_item.html` берёт series из `seriesByType[itemId]` (если файла нет — пытается `/api/market_history` локально).

### 2) Buy orders snapshot (замена `/api/buy_orders`)
Опционально (файл может быть очень тяжёлым).

Если генерировать:
- `json/buy_orders_10000002.json`

Формат:
```json
{
  "regionId": 10000002,
  "updated": "2025-12-16T00:00:00Z",
  "ordersByType": {
    "34": [ { "price": 1.23, "volume_remain": 1000 }, ... ]
  }
}
```

Фронт: `frontend/lp_item.html` сначала пытается этот файл, если его нет — берёт `/api/buy_orders` локально. На Pages при отсутствии файла блок покажет “No buy orders snapshot”.

### 3) LP corp index (замена `/api/lp_corp_index`)
Сгенерировать набор файлов (по корпорациям):
- `json/lp_corp_index/10000002/{corpId}_90_25.json`

Формат:
```json
{
  "corpId": 1000125,
  "regionId": 10000002,
  "days": 90,
  "series": [ { "date":"2025-12-01", "value": 1234, "coverage": 0.82 }, ... ],
  "meta": { "basketSize": 25, "basketLimit": 25, "generated": "2025-12-16T00:00:00Z" }
}
```

Фронт: `frontend/lp_corp.html` сначала пытается этот файл, если его нет — берёт `/api/lp_corp_index` локально.

## Пайплайн публикации (ПК)

### Вариант 1: Pages из ветки `gh-pages` (рекомендуется)
1) На ПК генерируем данные воркерами:
- `npm run ...` (твои джобы)
 - `npm run pages-market-history`
 - `npm run pages-corp-index`
2) Собираем “bundle” для Pages:
- `frontend/*`
- `json/*`
- `config/*` (если нужно)
3) Пушим bundle в ветку `gh-pages`:
- GitHub Pages настраиваем на `gh-pages` / root.

Плюс: в `main` можно держать код/воркеры, а в `gh-pages` — только сайт+данные.

### Вариант 2: Pages из `main`
Коммитишь `frontend/` + `json/` прямо в `main`. Работает, но история будет “шумной” из-за частых обновлений JSON.

## Мини-чеклист перед публикацией
- `cache/` и `SDE/` не должны попадать в git (проверить `.gitignore` и `git status`).
- Размер `json/*.json` < 50MB (желательно).
- Фронт не должен использовать `/api/*` (должен читать статические JSON).
