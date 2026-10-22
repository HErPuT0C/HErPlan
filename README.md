# HErPlan

**RU** · [EN](#english)

**HErPlan — бесплатный офлайн-редактор для геймдизайна под Windows.** Сюжет, герои и места, документы и задачи живут в одном проекте и связаны между собой. Всё хранится в обычной папке на вашем компьютере, интернет не нужен.

> Сейчас это ранняя версия: программа уже работает, но ещё дорабатывается. Если что-то пойдёт не так, откройте «Историю версий» в шапке проекта или нажмите Ctrl+Z.

## Что умеет

- **Сценарий.** Схема истории на холсте: главы, сцены, диалоги, выборы игрока, переменные и условия. Любую ветку можно пройти прямо в программе, а встроенные проверки найдут тупики и ошибки.
- **Герои, места, предметы.** База данных с карточками: свои поля, свои типы, связи между карточками, картинки и теги.
- **Документы.** Текстовые документы с картинками и ссылками на карточки героев и главы сюжета; экспорт в PDF и Markdown.
- **Задачи.** Доски с колонками, списками дел, метками и ссылками на сюжет, героев и документы.
- **Карта проекта.** Одна доска, на которой видно главы, документы, героев и заметки вместе.
- **Поиск по всему проекту** (Ctrl+K), **библиотека картинок** и файлов.
- **Ничего не теряется.** Автосохранение, резервные копии, история версий, восстановление после сбоя.
- **Экспорт для движка.** Сюжет и данные сохраняются в открытый формат JSON.
- **Интерфейс на русском и английском.**

## Попробовать

1. Откройте раздел **Releases** справа на странице репозитория и скачайте `HErPlan-<версия>-setup.exe`.
2. Запустите установщик. Права администратора не нужны, программа ставится только для вас, а новая версия встаёт поверх старой без потери данных.
3. Если Windows покажет «Windows защитил ваш компьютер» — нажмите **Подробнее → Выполнить в любом случае**. Установщик пока не подписан сертификатом, поэтому Windows настороженно относится к любой новой программе.
4. При первом запуске программа предложит **тур по возможностям** и **учебный проект «Последний фонарь»**: короткую готовую историю, на которой видно, как всё устроено. Тур можно пройти ещё раз в **Настройки → Обучение**.

**Без установки (портативная версия).** В том же релизе есть `HErPlan-<версия>-portable.zip`: распакуйте его куда угодно, хоть на флешку, и запустите `HErPlan.exe`. Настройки программа хранит в папке `data` рядом с собой, новые проекты по умолчанию в папке `Projects` там же. Для обновления замените `HErPlan.exe` новым. Подробности в файле `portable.txt` в архиве.

## Лицензия

[MIT](LICENSE): пользуйтесь, изменяйте и делитесь свободно.

Если вы разработчик и хотите собрать программу из исходников, см. [`docs/development.md`](docs/development.md).

---

## English

**HErPlan is a free, offline game design editor for Windows.** Your story, characters and places, documents and tasks live in one project and link to each other. Everything is kept in an ordinary folder on your computer; no internet is needed.

> This is an early version: it already works, but it is still being polished. If something goes wrong, open **Version history** in the project header or press Ctrl+Z.

### What it does

- **Story.** Draw your story on a canvas: chapters, scenes, dialogue, player choices, variables and conditions. Play any branch right in the app; built-in checks find dead ends and mistakes.
- **Characters, places, items.** A database of cards with your own fields and types, relations between cards, pictures and tags.
- **Documents.** Text documents with pictures and links to character cards and story chapters; export to PDF and Markdown.
- **Tasks.** Boards with columns, checklists, labels and links to the story, characters and documents.
- **Project map.** One board that shows chapters, documents, characters and notes together.
- **Search across the whole project** (Ctrl+K) and an **asset library** for pictures and files.
- **Nothing gets lost.** Autosave, backups, version history, crash recovery.
- **Export for your engine.** The story and data are saved in an open JSON format.
- **Russian and English interface.**

### Try it

1. Open **Releases** on the right of this page and download `HErPlan-<version>-setup.exe`.
2. Run the installer. No administrator rights are needed; it installs just for you, and a new version installs over the old one without losing your data.
3. If Windows shows "Windows protected your PC", click **More info → Run anyway**. The installer is not signed with a certificate yet, so Windows is cautious about any new program.
4. On first launch the app offers a **tour of its features** and the **tutorial project "The Last Lantern"**, a short ready-made story that shows how everything fits together. You can take the tour again in **Settings → Learning**.

**Without installing (portable version).** The same release has `HErPlan-<version>-portable.zip`: unpack it anywhere, a USB stick included, and run `HErPlan.exe`. The program keeps its settings in a `data` folder beside it and new projects in a `Projects` folder there by default. To update, replace `HErPlan.exe` with the new one. See `portable.txt` in the archive for details.

### License

[MIT](LICENSE): use, change and share freely.

If you are a developer and want to build from source, see [`docs/development.md`](docs/development.md).
