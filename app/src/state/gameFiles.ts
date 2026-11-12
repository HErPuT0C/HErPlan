// The files the game side keeps in the project folder (0.8): the palette HErPlan offers in the dialogue
// editor, what was carried over into the game, and the game's translations of the lines. HErPlan only reads them: when a project opens, when the
// window gets the focus back (the files are written by another program), and when asked.

import { useEffect } from 'react';
import { atom } from '../core/atom';
import { useAtom } from '../core/useStore';
import { platform } from '../platform';
import { EMPTY_PALETTE, PALETTE_FILE, parsePalette, type Palette } from '../story/palette';
import { forgetImages, forgetSounds } from '../ui/story/gameAssets';
import { IMPORT_FILE, parseImport, type ImportStatus } from '../story/transfer';
import { parseTranslations, TRANSLATIONS_FILE, type Translations } from '../story/translation';

export interface GameFiles {
  /** The project folder these were read from. */
  dir: string | null;
  palette: Palette;
  /** The palette file exists; `paletteOk` false: it is there but cannot be read. */
  paletteFound: boolean;
  paletteOk: boolean;
  status: ImportStatus;
  statusOk: boolean;
  /** Lines in the game's other languages, by line or option id. */
  translations: Translations;
  translationsOk: boolean;
}

const NONE: GameFiles = {
  dir: null,
  palette: EMPTY_PALETTE,
  paletteFound: false,
  paletteOk: true,
  status: {},
  statusOk: true,
  translations: {},
  translationsOk: true,
};

export const gameFiles = atom<GameFiles>(NONE);

let reading: string | null = null;
/** The palette's text as last read: when it changes, its pictures may have changed too. */
let lastPalette: string | null = null;

/** Reads the files of a project again; what was read before stays until the new is there. */
export async function loadGameFiles(dir: string): Promise<void> {
  reading = dir;
  const read = (path: string) =>
    platform()
      .readProjectFile(dir, path)
      .catch(() => null);
  const [paletteText, statusText, translationsText] = await Promise.all([
    read(PALETTE_FILE),
    read(IMPORT_FILE),
    read(TRANSLATIONS_FILE),
  ]);
  // Another project was opened meanwhile.
  if (reading !== dir) return;
  if (paletteText !== lastPalette) {
    lastPalette = paletteText;
    forgetImages();
    forgetSounds();
  }
  const palette = parsePalette(paletteText);
  const status = parseImport(statusText);
  const translations = parseTranslations(translationsText);
  const next: GameFiles = {
    dir,
    palette: palette.palette,
    paletteFound: paletteText !== null,
    paletteOk: palette.ok,
    status: status.status,
    statusOk: status.ok,
    translations: translations.translations,
    translationsOk: translations.ok,
  };
  // The same content: keep the same object, so nothing is drawn again.
  if (JSON.stringify(next) !== JSON.stringify(gameFiles.get())) gameFiles.set(next);
}

/** How often the files are read again while the window is shown: the game side writes them when it likes. */
const POLL_MS = 4000;

/**
 * The game's files of a project, read when the component appears, whenever the window is focused again, and
 * every few seconds while it is shown (0.8.1: the palette is read again when it has changed).
 */
export function useGameFiles(dir: string): GameFiles {
  const files = useAtom(gameFiles);
  useEffect(() => {
    void loadGameFiles(dir);
    const again = () => void loadGameFiles(dir);
    window.addEventListener('focus', again);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') again();
    }, POLL_MS);
    return () => {
      window.removeEventListener('focus', again);
      window.clearInterval(timer);
    };
  }, [dir]);
  return files.dir === dir ? files : NONE;
}
