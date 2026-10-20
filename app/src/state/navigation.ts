// Requests to show something in another editor: "where used" in the variables panel or a problem in the
// checks list takes the designer to a node; the workspace opens the story tab and the editor reveals it.

import { atom } from '../core/atom';

export interface RevealRequest {
  graph: string;
  node?: string;
  edge?: string;
  /** A field of the node to open in the inspector ("mark:<id>" for a plot device). */
  field?: string;
  /** Nodes to highlight on the canvas along with it (every place a variable is used). */
  highlight?: string[];
  /** Distinguishes two requests for the same place. */
  at: number;
}

export const revealRequest = atom<RevealRequest | null>(null);

export function revealInStory(target: Omit<RevealRequest, 'at'>): void {
  revealRequest.set({ ...target, at: performance.now() });
}

/** The project-wide variables panel (FR-NAR-04): one panel, reachable from every editor. */
export const variablesPanel = atom<{ open: boolean; focus: string | null }>({ open: false, focus: null });

export function openVariables(focus: string | null = null): void {
  variablesPanel.set({ open: true, focus });
}

export function closeVariables(): void {
  variablesPanel.set({ open: false, focus: null });
}
