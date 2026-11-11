// The game's translations (0.8, item 20 of "Dialogues"): data/dialogue_translations.json, written by the
// game side, holds the text of lines and options in the game's other languages by their ids. HErPlan only
// shows it next to the line, read-only, and says when the line was changed after it was translated.

export const TRANSLATIONS_FILE = 'data/dialogue_translations.json';

export interface Translated {
  text: string;
  /** When it was translated (ISO 8601), when the game says. */
  at: string | null;
}

/** Language code → line or option id → its translation. */
export type Translations = Record<string, Record<string, Translated>>;

const LANGUAGE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

/**
 * Reads the file: `{ "en": { "<id>": "text" | { "text": "…", "at": "…" } } }`. Keys that are not language
 * codes, and entries that are not text, are skipped. A missing file is "no translations"; `ok` is false
 * when the file is there but is not JSON of that shape.
 */
export function parseTranslations(text: string | null): { translations: Translations; ok: boolean } {
  if (text === null) return { translations: {}, ok: true };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { translations: {}, ok: false };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { translations: {}, ok: false };
  const out: Translations = {};
  for (const [lang, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!LANGUAGE.test(lang) || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    const list: Record<string, Translated> = {};
    for (const [id, value] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof value === 'string') list[id] = { text: value, at: null };
      else if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
        const at = (value as { at?: unknown }).at;
        list[id] = {
          text: (value as { text: string }).text,
          at: typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null,
        };
      }
    }
    if (Object.keys(list).length) out[lang] = list;
  }
  return { translations: out, ok: true };
}

/** The translations of one line or option, by language; `stale` when it was edited after being translated. */
export function translationsOf(
  all: Translations,
  id: string,
  edited?: string,
): { lang: string; text: string; stale: boolean }[] {
  return Object.entries(all)
    .filter(([, list]) => list[id])
    .map(([lang, list]) => {
      const tr = list[id];
      const stale = !!edited && !!tr.at && Date.parse(edited) > Date.parse(tr.at);
      return { lang, text: tr.text, stale };
    });
}
