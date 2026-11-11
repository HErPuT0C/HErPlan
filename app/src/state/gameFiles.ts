// The two files the game side keeps in the project folder (0.8): the palette HErPlan offers in the dialogue
// editor, and what was carried over into the game. HErPlan only reads them: when a project opens, when the
// window gets the focus back (the files are written by another program), and when asked.

import { useEffect } from 'react';
import { atom } from '../core/atom';
import { useAtom } from '../core/useStore';
import { platform } from '../platform';
import { EMPTY_PALETTE, PALETTE_FILE, parsePalette, type Palette } from '../story/palette';
import { IMPORT_FILE, parseImport, type ImportStatus } from '../story/transfer';

export interface GameFiles {
  /** The project folder these were read from. */
  dir: string | null;
  palette: Palette;
  /** The palette file exists; `paletteOk` false: it is there but cannot be read. */
  paletteFound: boolean;
  paletteOk: boolean;
  status: ImportStatus;
  statusOk: boolean;
}

const NONE: GameFiles = {
  dir: null,
  palette: EMPTY_PALETTE,
  paletteFound: false,
  paletteOk: true,
  status: {},
  statusOk: true,
};

export const gameFiles = atom<GameFiles>(NONE);

let reading: string | null = null;

/** Reads both files of a project again; what was read before stays until the new is there. */
export async function loadGameFiles(dir: string): Promise<void> {
  reading = dir;
  const read = (path: string) =>
    platform()
      .readProjectFile(dir, path)
      .catch(() => null);
  const [paletteText, statusText] = await Promise.all([read(PALETTE_FILE), read(IMPORT_FILE)]);
  // Another project was opened meanwhile.
  if (reading !== dir) return;
  const palette = parsePalette(paletteText);
  const status = parseImport(statusText);
  const next: GameFiles = {
    dir,
    palette: palette.palette,
    paletteFound: paletteText !== null,
    paletteOk: palette.ok,
    status: status.status,
    statusOk: status.ok,
  };
  // The same content: keep the same object, so nothing is drawn again.
  if (JSON.stringify(next) !== JSON.stringify(gameFiles.get())) gameFiles.set(next);
}

/** The game's files of a project, read when the component appears and whenever the window is focused again. */
export function useGameFiles(dir: string): GameFiles {
  const files = useAtom(gameFiles);
  useEffect(() => {
    void loadGameFiles(dir);
    const again = () => void loadGameFiles(dir);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [dir]);
  return files.dir === dir ? files : NONE;
}
