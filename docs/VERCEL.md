# Deploy to Vercel (recommended: static)

## Why your deploy failed

Vercel runs your project's `npm run build` during deployment.

Previously our `build` script executed `worker_runner.js`, which:

- tries to run data workers (ETL) during build (not what we want)
- referenced `Config/...` (capital **C**). On Linux (Vercel) the filesystem is case-sensitive, so it failed to find `config/...`.

## Recommended setup (workers on your PC, Vercel hosts static)

Use the **`gh-pages`** branch as a static site:

1. In Vercel → New Project → import `MarpatOG/evegem`
2. **Git Branch**: select `gh-pages`
3. **Framework Preset**: `Other`
4. **Build Command**: leave empty (or keep default, it's a no-op now)
5. **Output Directory**: `.`
6. Deploy

This branch contains:

- HTML pages in repository root (`index.html`, `lp.html`, `lp_items.html`, ...)
- `/json` with prebuilt data for the frontend
- `/config` with UI configs

## Optional: deploy `main` on Vercel

`main` is the full project (workers + server + frontend sources). Vercel can host it, but:

- it is **not** a good fit for serverless because we rely on filesystem caches
- it requires a different setup (not MVP)

If you still want to try, the correct path is to deploy the `gh-pages` branch.

