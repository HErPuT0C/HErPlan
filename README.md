# HErPlan

**RU** · [EN](#english)

HErPlan — бесплатный офлайн-редактор для геймдизайна под Windows. Сценарий, база игрового мира и документы живут в одном проекте и связаны ссылками.

> **Статус: в разработке (пре-альфа, веха v0.1 «Каркас»).** Уже работают проекты: создание с обложкой, автосохранение, копии и история версий, восстановление после сбоя, экспорт и импорт .zip, настройки, RU/EN. Редакторов (холст, база, документы) пока нет. Ход работ — в [`PIPELINE.md`](PIPELINE.md).

## Как попробовать

Установщик для Windows собирается автоматически на каждое изменение ветки `main`: GitHub → **Actions** → workflow **ci** → последний зелёный прогон на `main` → артефакт **HErPlan-installer** (zip с `HErPlan-…-setup.exe`). Установка — для текущего пользователя, права администратора не нужны. Пока установщик не подписан, Windows может показать «Windows защитил ваш компьютер» → «Подробнее» → «Выполнить в любом случае».

## Разработка

```
cd app
npm ci
npm run dev          # интерфейс в браузере (данные — в памяти браузера)
npm run tauri dev    # настоящее окно с Rust-бэкендом
npm test             # юнит-тесты; npm run e2e — сквозные тесты в Chromium
cargo test --workspace   # из корня репозитория: Rust
```

## Что будет в первой версии

- **Холст узлов** для сценария: главы и сцены, диалоги, выборы, переменные, условия и эффекты, приёмы «эффект бабочки» и «чеховское ружьё». Ветки можно проверить в режиме прохождения.
- **База данных** персонажей, локаций, предметов и своих типов: типизированные поля, общие наборы свойств, связи между сущностями.
- **Документы** в Markdown с живыми вставками из базы; экспорт в PDF и Markdown.
- **Карта проекта**, **канбан**, **библиотека ресурсов**.
- **Надёжное хранение:** проект — обычная папка на диске, автосохранение, резервные копии, восстановление после сбоя.
- **Экспорт в JSON** по открытой схеме; после первой версии — импортёры для Unity и GameMaker.

Подробные требования: [`docs/spec.md`](docs/spec.md). Архитектурные решения: [`docs/adr/`](docs/adr/).

## Лицензия

[MIT](LICENSE). Форки приветствуются.

---

## English

HErPlan is a free, offline game design editor for Windows. Story, game-world database and design documents live in one project and link to each other.

> **Status: in development (pre-alpha, milestone v0.1 "Skeleton").** Projects already work: creating with a cover, autosave, backups and version history, crash recovery, .zip export and import, settings, RU/EN. The editors (canvas, database, documents) are not there yet. Progress is tracked in [`PIPELINE.md`](PIPELINE.md) (in Russian).

To try it: GitHub → Actions → **ci** → the latest green run on `main` → artifact **HErPlan-installer**.

Planned for the first version: a node canvas for branching stories with variables, conditions, effects and a playthrough mode; a typed database of characters, locations and items with relations; Markdown documents with live embeds and PDF/Markdown export; project map, kanban board and asset library; a plain project folder on disk with autosave, backups and crash recovery; JSON export with an open schema (Unity and GameMaker importers after 1.0).

License: [MIT](LICENSE). Forks are welcome.
