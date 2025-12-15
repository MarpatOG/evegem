# GitHub / GitHub Pages — публикация EveGem

Этот документ описывает, как:
1) подключить репозиторий по SSH,
2) запушить код,
3) включить GitHub Pages,
4) обновлять Pages из результатов воркеров на ПК.

## 1) Исправить ошибку `Permission denied (publickey)`

Ошибка при `git push`:
```
git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.
```

Означает: на ПК нет SSH‑ключа, или ключ не добавлен в GitHub.

### Шаги (Windows)
1) Проверить ключи:
- `dir $env:USERPROFILE\\.ssh`

2) Если ключей нет — создать:
- `ssh-keygen -t ed25519 -C "you@example.com"`

3) Запустить ssh-agent и добавить ключ:
- `Get-Service ssh-agent | Set-Service -StartupType Automatic`
- `Start-Service ssh-agent`
- `ssh-add $env:USERPROFILE\\.ssh\\id_ed25519`

4) Добавить публичный ключ в GitHub:
- скопировать содержимое `~/.ssh/id_ed25519.pub`
- GitHub → Settings → SSH and GPG keys → New SSH key

5) Проверить:
- `ssh -T git@github.com`

После этого `git push` должен заработать.

## 2) Пуш в `main`
В корне проекта:
- `git push -u origin main`

## 3) GitHub Pages (рекомендуемый вариант)

### Ветка `gh-pages`
Pages лучше вести отдельной веткой, где лежит только статический сайт:
- HTML/JS/CSS (из `frontend/`)
- `json/` (готовые датасеты)
- `config/` (если используется на фронте)

`server.js` и `workers/` на Pages не исполняются.

### Настройка Pages
GitHub repo → Settings → Pages:
- Source: `Deploy from a branch`
- Branch: `gh-pages`
- Folder: `/ (root)`

## 4) Обновление Pages из ПК (типовой цикл)
1) На ПК генерируем данные:
- `npm run run-all`
- `npm run pages-market-history`
- `npm run pages-corp-index`

2) Публикуем в `gh-pages`:
- скопировать `frontend/*` в корень ветки `gh-pages`
- скопировать `json/*` и `config/*`
- коммит + push

Подробности и список файлов см. `docs/DEPLOYMENT.md`.
