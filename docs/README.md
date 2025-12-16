# EveGem — документация

Точка входа для разработчиков и Codex. Репозиторий local-first: тяжёлые данные/снапшоты живут локально, а фронт читает готовые JSON.

## Что делает проект
- LP Shop аналитика: предметы/корпорации/офферы + метрики (ISK/LP, volume, risk, LP capacity, LP weight)
- Market аналитика (ESI): история цен/объёма и buy orders (для быстрых расчётов)
- System stats: активность по системам (таблица)

Фокус: “decision-making UI”, а не дампы.

## Стек
- Node.js 22 (ESM)
- Express (`server.js`)
- Workers (`/workers`) — генерация данных и кэшей
- Источники:
  - CCP SDE (YAML в `SDE/yaml/`)
  - ESI (market endpoints)
  - zKillboard (часть пайплайна)

## Как запустить локально
- `npm install`
- `node server.js` → `http://localhost:8090`

## Структура проекта (source of truth)
- `frontend/` — статические страницы (`index.html`, `lp.html`, `lp_items.html`, `lp_corp.html`, `lp_item.html`)
- `server.js` — статическая раздача + небольшие helper API под `/api/*`
- `workers/` — тяжёлые джобы/ETL
- `json/` — “frontend contract”: датасеты, которые реально грузит UI через `/json/*`
- `cache/` — тяжёлые/временные файлы (история рынка, снапшоты, universe dumps и т.п.)
- `config/` — ручные overrides (hide lists и т.д.)
- `docs/` — документация

## Правила
- Фронт не ходит напрямую в ESI/zkb — только `/json/*` и (локально) `/api/*`.
- Любое изменение формата данных → обновить `docs/DATA.md`.
- Любое изменение формул/логики метрик → записать в `docs/DECISIONS.md`.
- Архитектурные изменения → обновить `docs/ARCHITECTURE.md`.

## Чеклист перед пушем на GitHub

### 1) Проверка секретов
В проекте не должно быть ключей/токенов/паролей. Быстрая проверка:

`rg -n "api[_-]?key|secret|token|authorization|password|client[_-]?secret|refresh[_-]?token" -S .`

### 2) Большие файлы (лимиты GitHub)
GitHub рекомендует держать отдельные файлы < 50 MB (hard limit 100 MB).

Крупные кандидаты в коммит сейчас:
- `json/lp_item_offers.json` (~33 MB)
- `json/lp_offers.json` (~31 MB)

Это обычно допустимо, но замедляет clone/pull и делает PR/diff неудобными.

### 3) Что НЕ коммитить
Должно оставаться локальным (см. `.gitignore`):
- `node_modules/`
- `cache/`
- `SDE/`

### 4) Что коммитить
Если проект должен работать на GitHub Pages (статический хостинг), то `json/` имеет смысл коммитить, потому что это контракт фронта.

Если данные будут генериться только на ПК/VPS — можно не коммитить тяжёлые `json/*`, а публиковать их отдельно.

## Деплой (ПК → GitHub Pages)
См. `docs/DEPLOYMENT.md`.

## Таблицы и метрики
См. `docs/TABLES.md` — описание всех таблиц/колонок/метрик и формулы. Обновляй этот файл при любых изменениях метрик или полей в табличных данных.
