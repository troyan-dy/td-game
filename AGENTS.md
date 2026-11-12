## Правила проекта

### Автокоммит

Каждое законченное изменение сразу коммить в текущую ветку, не спрашивая разрешения: один логический шаг — один коммит с сообщением на русском. Рабочее дерево после завершения задачи остаётся чистым. Push делается только по просьбе: push в `main` выкатывает игру на GitHub Pages.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `troyan-dy/td-game`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
