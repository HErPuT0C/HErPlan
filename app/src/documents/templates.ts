// Templates of documents (F5-06): a few of our own, written for HErPlan in both languages, and the designer's
// own, kept in data/documents.json. A template is Markdown; a new document starts as a copy of it.

import { newId } from '../core/ids';
import type { ProjectData } from '../core/project/types';
import type { Locale } from '../i18n';

export interface DocumentTemplate {
  id: string;
  name: string;
  body: string;
  /** What the template is for, in one line (our own templates). */
  hint?: string;
}

type BuiltIn = {
  id: string;
  name: Record<Locale, string>;
  hint: Record<Locale, string>;
  body: Record<Locale, string>;
};

const GDD: BuiltIn = {
  id: 'gdd',
  name: { ru: 'Диздок (GDD)', en: 'Game design document' },
  hint: {
    ru: 'Идея, игровой цикл, механики, мир, монетизация',
    en: 'Idea, core loop, mechanics, world, business model',
  },
  body: {
    ru: `# Диздок

## Коротко

Жанр, платформы, для кого игра — в двух-трёх предложениях.

## Главная идея

Что игрок чувствует и делает, чего нет в других играх.

## Игровой цикл

1. Что игрок делает каждую минуту.
2. Что — каждый час.
3. Ради чего возвращается завтра.

## Механики

- Механика: как работает, зачем нужна.

## Мир и сюжет

Где и когда всё происходит. Главный конфликт. Связь со сценарием — ссылкой на главу через «@».

## Персонажи

| Персонаж | Роль | Чего хочет |
| --- | --- | --- |
|  |  |  |

## Уровни и прогресс

## Интерфейс и управление

## Звук и музыка

## Открытые вопросы

-
`,
    en: `# Game design document

## In short

Genre, platforms, audience — in two or three sentences.

## Core idea

What the player feels and does that other games do not offer.

## Game loop

1. What the player does every minute.
2. What they do every hour.
3. Why they come back tomorrow.

## Mechanics

- Mechanic: how it works, why it is there.

## World and story

Where and when it happens. The main conflict. Link the chapters of the story with "@".

## Characters

| Character | Role | Wants |
| --- | --- | --- |
|  |  |  |

## Levels and progression

## Interface and controls

## Sound and music

## Open questions

-
`,
  },
};

const PITCH: BuiltIn = {
  id: 'pitch',
  name: { ru: 'Питч для издателя', en: 'Publisher pitch' },
  hint: { ru: 'Коротко об игре для издателя или инвестора', en: 'The game in brief for a publisher or an investor' },
  body: {
    ru: `# Питч

## Одной фразой

Игра про … , в которой игрок … .

## Почему её захотят

- Для кого:
- На что похожа и чем отличается:

## Что уже есть

Прототип, демо, видео, сколько глав сценария готово.

## Команда

| Кто | Что делает | Опыт |
| --- | --- | --- |
|  |  |  |

## Сроки и бюджет

## Что мы просим

Финансирование, издание, маркетинг, портирование — и на каких условиях.
`,
    en: `# Pitch

## In one sentence

A game about … where the player … .

## Why people will want it

- For whom:
- What it is like and how it differs:

## What exists already

Prototype, demo, video, how many chapters of the story are written.

## Team

| Who | Does what | Experience |
| --- | --- | --- |
|  |  |  |

## Schedule and budget

## What we ask for

Funding, publishing, marketing, ports — and on what terms.
`,
  },
};

const WIKI: BuiltIn = {
  id: 'wiki',
  name: { ru: 'Вики мира', en: 'World wiki' },
  hint: { ru: 'Статья о месте, народе или событии мира', en: 'An article about a place, a people or an event' },
  body: {
    ru: `# Вики мира

## Обзор

## История

| Когда | Что случилось |
| --- | --- |
|  |  |

## Места

Упоминайте локации через «@» — ссылки ведут в их карточки.

## Силы и фракции

## Персонажи

## Предметы

## Словарь

- **Слово** — значение.
`,
    en: `# World wiki

## Overview

## History

| When | What happened |
| --- | --- |
|  |  |

## Places

Mention locations with "@" — the links lead to their cards.

## Powers and factions

## Characters

## Items

## Glossary

- **Word** — meaning.
`,
  },
};

const LEVEL: BuiltIn = {
  id: 'level',
  name: { ru: 'Документ уровня', en: 'Level document' },
  hint: {
    ru: 'Цели, путь игрока, враги, награды и ритм уровня',
    en: "Goals, the player's path, enemies, rewards, pacing",
  },
  body: {
    ru: `# Уровень

## Цель

Что игрок должен сделать и чему научиться.

## Место в истории

Какая глава сценария, что было до и что будет после.

## Карта

Картинку карты можно вставить из ресурсов.

## Прохождение

1.
2.
3.

## Противники и препятствия

| Кто или что | Где | Как преодолеть |
| --- | --- | --- |
|  |  |  |

## Награды

## Открытые вопросы

-
`,
    en: `# Level

## Goal

What the player has to do and learn.

## Place in the story

Which chapter, what comes before and after.

## Map

Insert a picture of the map from the assets.

## Walkthrough

1.
2.
3.

## Enemies and obstacles

| Who or what | Where | How to get past |
| --- | --- | --- |
|  |  |  |

## Rewards

## Open questions

-
`,
  },
};

const BUILT_IN: BuiltIn[] = [GDD, PITCH, WIKI, LEVEL];

export function builtInTemplates(locale: Locale): DocumentTemplate[] {
  return BUILT_IN.map((x) => ({ id: x.id, name: x.name[locale], hint: x.hint[locale], body: x.body[locale] }));
}

/** The designer's own templates (data/documents.json → templates). */
export function ownTemplates(data: Pick<ProjectData, 'documentMeta'>): DocumentTemplate[] {
  const list = data.documentMeta.templates;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (x): x is DocumentTemplate =>
        !!x &&
        typeof x === 'object' &&
        typeof x.id === 'string' &&
        typeof x.name === 'string' &&
        typeof x.body === 'string',
    )
    .map(({ id, name, body }) => ({ id, name, body }));
}

export function saveTemplate(d: ProjectData, name: string, body: string): string {
  if (!Array.isArray(d.documentMeta.templates)) d.documentMeta.templates = [];
  const id = newId();
  (d.documentMeta.templates as DocumentTemplate[]).push({ id, name: name.trim(), body });
  return id;
}

export function deleteTemplate(d: ProjectData, id: string): void {
  if (!Array.isArray(d.documentMeta.templates)) return;
  d.documentMeta.templates = (d.documentMeta.templates as DocumentTemplate[]).filter((x) => x.id !== id);
}
