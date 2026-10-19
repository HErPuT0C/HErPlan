# HErPlan

**RU** · [EN](#english)

HErPlan — бесплатный офлайн-редактор для геймдизайна под Windows. Сценарий, база игрового мира и документы живут в одном проекте и связаны ссылками.

> **Статус: в разработке (пре-альфа, веха v0.2 «Сценарий»).** Работают проекты (автосохранение, копии и история версий, восстановление после сбоя, экспорт и импорт .zip) и редактор сценария: обзор глав и главы на холсте, диалоги, выборы, условия и эффекты, единый реестр переменных, эффект бабочки и чеховское ружьё, проверки проекта, тестовое прохождение и экспорт в JSON. Карточки персонажей, локаций и предметов — пока в упрощённом виде. Ход работ — в [`PIPELINE.md`](PIPELINE.md).

## Как попробовать

**Релизы:** GitHub → **Releases** → `HErPlan-<версия>-setup.exe`. **Сборки между релизами:** GitHub → **Actions** → workflow **ci** → последний зелёный прогон на `main` → артефакт `HErPlan-<версия>-build<N>-installer` (в «О программе» видно «сборка N»). Установка — для текущего пользователя, права администратора не нужны, новая версия ставится поверх старой с сохранением настроек. Пока установщик не подписан, Windows может показать «Windows защитил ваш компьютер» → «Подробнее» → «Выполнить в любом случае».

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

Подробные требования: [`docs/spec.md`](docs/spec.md). Архитектурные решения: [`docs/adr/`](docs/adr/). Формат проекта: [`docs/format/project-v1.md`](docs/format/project-v1.md), экспорт для движков: [`docs/format/export-v1.md`](docs/format/export-v1.md).

## Лицензия

[MIT](LICENSE). Форки приветствуются.

---

## English

HErPlan is a free, offline game design editor for Windows. Story, game-world database and design documents live in one project and link to each other.

> **Status: in development (pre-alpha, milestone v0.2 "Story").** Projects work (autosave, backups and version history, crash recovery, .zip export and import), and so does the story editor: chapter overview and chapters on the canvas, dialogue, choices, conditions and effects, a single variable registry, butterfly effects and Chekhov's guns, project checks, a test playthrough and JSON export ([schema](docs/format/export-v1.md)). Characters, locations and items exist in a simple form for now. Progress is tracked in [`PIPELINE.md`](PIPELINE.md) (in Russian).

To try it: GitHub → **Releases** → `HErPlan-<version>-setup.exe`; builds between releases are artifacts of the latest green **ci** run on `main`.

Planned for the first version: a node canvas for branching stories with variables, conditions, effects and a playthrough mode; a typed database of characters, locations and items with relations; Markdown documents with live embeds and PDF/Markdown export; project map, kanban board and asset library; a plain project folder on disk with autosave, backups and crash recovery; JSON export with an open schema (Unity and GameMaker importers after 1.0).

License: [MIT](LICENSE). Forks are welcome.
