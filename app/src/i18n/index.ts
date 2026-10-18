// Interface strings. Every visible text goes through t(); a test checks that RU and EN have the same keys.
// Full locale switching and persistence come with task F1-05.

export const ru = {
  'app.name': 'HErPlan',
  'app.tagline': 'Редактор для геймдизайна: сценарий, база мира и документы в одном проекте.',
  'app.status': 'Каркас приложения · версия {version}',
} as const;

export type MessageKey = keyof typeof ru;

export const en: Record<MessageKey, string> = {
  'app.name': 'HErPlan',
  'app.tagline': 'A game design editor: story, world database and documents in one project.',
  'app.status': 'Application skeleton · version {version}',
};

const dictionaries = { ru, en } as const;
export type Locale = keyof typeof dictionaries;

let current: Locale = 'ru';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const template: string = dictionaries[current][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
