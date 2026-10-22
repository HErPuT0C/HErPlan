# Разработка · Development

## Сборка и запуск

```
cd app
npm ci
npm run dev          # интерфейс в браузере (данные — в памяти браузера)
npm run tauri dev    # настоящее окно с Rust-бэкендом
npm test             # юнит-тесты; npm run e2e — сквозные тесты в Chromium
cargo test --workspace   # из корня репозитория: Rust
```

## Документы

- Ход работ: [`PIPELINE.md`](../PIPELINE.md) (на русском).
- Требования: [`spec.md`](spec.md). Архитектурные решения: [`adr/`](adr/).
- Формат проекта: [`format/project-v1.md`](format/project-v1.md). Экспорт для движков: [`format/export-v1.md`](format/export-v1.md).

## Сборки между релизами

GitHub → **Actions** → workflow **ci** → последний зелёный прогон на `main` → артефакт `HErPlan-<версия>-build<N>-installer`.
