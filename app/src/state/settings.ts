// Application settings (not per project): language, accent, interface scale, recent projects.
// Stored as settings.json in the user's application data folder; survives reinstalling a newer version.
// Parsing is forgiving: a missing or wrong field falls back to its default, unknown fields are kept.

import { atom } from '../core/atom';
import { detectLocale, isLocale, setLocale, type Locale } from '../i18n';
import { platform } from '../platform';

export type Accent = 'mint' | 'indigo' | 'amber';
export const ACCENTS: readonly Accent[] = ['mint', 'indigo', 'amber'];
export const UI_SCALES: readonly number[] = [80, 90, 100, 110, 125, 150, 175, 200];
export const RECENT_LIMIT = 20;

export interface RecentProject {
  path: string;
  name: string;
  id: string;
  /** Cover path inside the project, if any. */
  cover: string | null;
  openedAt: string;
}

export interface AppSettings {
  version: 1;
  locale: Locale;
  accent: Accent;
  uiScale: number;
  /** Mouse button that pans canvases (Space + left button always works too). */
  panButton: 'middle' | 'right';
  autosaveSeconds: number;
  dashboardView: 'cards' | 'list';
  /** Last folder where a project was created; null means Documents\HErPlan. */
  projectsDir: string | null;
  recentProjects: RecentProject[];
  [extra: string]: unknown;
}

export function defaultSettings(languages: readonly string[]): AppSettings {
  return {
    version: 1,
    locale: detectLocale(languages),
    accent: 'mint',
    uiScale: 100,
    panButton: 'middle',
    autosaveSeconds: 5,
    dashboardView: 'cards',
    projectsDir: null,
    recentProjects: [],
  };
}

function oneOf<T>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function isRecent(value: unknown): value is RecentProject {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.path === 'string' && typeof r.name === 'string' && typeof r.openedAt === 'string';
}

export function parseSettings(text: string | null, languages: readonly string[]): AppSettings {
  const defaults = defaultSettings(languages);
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      raw = parsed as Record<string, unknown>;
  } catch {
    // Damaged settings: start from defaults rather than refusing to start.
  }
  const autosave = Number(raw.autosaveSeconds);
  return {
    ...raw,
    version: 1,
    locale: isLocale(raw.locale) ? raw.locale : defaults.locale,
    accent: oneOf(raw.accent, ACCENTS, defaults.accent),
    uiScale: oneOf(raw.uiScale, UI_SCALES, defaults.uiScale),
    panButton: oneOf(raw.panButton, ['middle', 'right'] as const, defaults.panButton),
    autosaveSeconds:
      Number.isInteger(autosave) && autosave >= 1 && autosave <= 60 ? autosave : defaults.autosaveSeconds,
    dashboardView: oneOf(raw.dashboardView, ['cards', 'list'] as const, defaults.dashboardView),
    projectsDir: typeof raw.projectsDir === 'string' && raw.projectsDir ? raw.projectsDir : null,
    recentProjects: Array.isArray(raw.recentProjects)
      ? raw.recentProjects.filter(isRecent).map((r) => ({
          path: r.path,
          name: r.name,
          id: typeof r.id === 'string' ? r.id : '',
          cover: typeof r.cover === 'string' && r.cover ? r.cover : null,
          openedAt: r.openedAt,
        }))
      : [],
  };
}

export function serializeSettings(settings: AppSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** Windows paths are case-insensitive; the same folder must not appear twice in the list. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p
      .replace(/[\\/]+$/, '')
      .replace(/\\/g, '/')
      .toLowerCase();
  return norm(a) === norm(b);
}

export function withRecent(settings: AppSettings, entry: RecentProject): AppSettings {
  const rest = settings.recentProjects.filter((r) => !samePath(r.path, entry.path));
  return { ...settings, recentProjects: [entry, ...rest].slice(0, RECENT_LIMIT) };
}

export function withoutRecent(settings: AppSettings, path: string): AppSettings {
  return { ...settings, recentProjects: settings.recentProjects.filter((r) => !samePath(r.path, path)) };
}

// --- Live settings of the running application ---

export const settings = atom<AppSettings>(defaultSettings(navigatorLanguages()));

function navigatorLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function apply(s: AppSettings): void {
  setLocale(s.locale);
  document.documentElement.dataset.accent = s.accent;
  void platform()
    .setUiScale(s.uiScale)
    .catch(() => undefined);
}

/** Reads settings at startup and applies language, accent and scale before the first screen renders. */
export async function loadSettings(): Promise<void> {
  const text = await platform()
    .loadSettings()
    .catch(() => null);
  settings.set(parseSettings(text, navigatorLanguages()));
  apply(settings.get());
}

/** Changes settings, applies them at once and saves them shortly after (several quick changes, one write). */
export function updateSettings(change: (s: AppSettings) => AppSettings): void {
  const before = settings.get();
  settings.set(change(before));
  const after = settings.get();
  if (after.locale !== before.locale || after.accent !== before.accent || after.uiScale !== before.uiScale) {
    apply(after);
  }
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void platform()
      .saveSettings(serializeSettings(settings.get()))
      .catch((e) => console.error('settings were not saved', e));
  }, 300);
}

/** Writes pending settings now (before the window closes). */
export async function flushSettings(): Promise<void> {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await platform().saveSettings(serializeSettings(settings.get()));
}
