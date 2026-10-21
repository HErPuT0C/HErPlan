// Requests to show something in another editor: "where used" in the variables panel or a problem in the
// checks list takes the designer to a node; the workspace opens the story tab and the editor reveals it.

import { atom } from '../core/atom';
import type { ModuleKind } from './workspace';

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

/** "Open this card" from anywhere (Ctrl+click on a link to an entity): the database tab shows it. */
export const entityRequest = atom<{ id: string; at: number } | null>(null);

export function openEntity(id: string): void {
  entityRequest.set({ id, at: performance.now() });
}

/** "Show this card on the project map" (where a picture is used): the map tab opens and selects it. */
export const mapRequest = atom<{ node: string | null; at: number } | null>(null);

export function openMap(node: string | null = null): void {
  mapRequest.set({ node, at: performance.now() });
}

/** "Open this document" from anywhere (a link in another document, the project map): the documents tab shows it. */
export const documentRequest = atom<{ id: string; at: number } | null>(null);

export function openDocument(id: string): void {
  documentRequest.set({ id, at: performance.now() });
}

/** "Open this catalog of tags" (from a tags field of a card): the database shows the catalog. */
export const catalogRequest = atom<{ id: string; at: number } | null>(null);

export function openCatalog(id: string): void {
  catalogRequest.set({ id, at: performance.now() });
}

/** "Show this file in the assets" (a link to a file in a document): the assets tab opens its folder and selects it. */
export const assetRequest = atom<{ path: string; at: number } | null>(null);

export function revealAsset(path: string): void {
  assetRequest.set({ path, at: performance.now() });
}

/** "Open this task" (where an object is used, the search): the tasks tab shows its board and opens it. */
export const taskRequest = atom<{ id: string; at: number } | null>(null);

export function openTask(id: string): void {
  taskRequest.set({ id, at: performance.now() });
}

/** "Show this part of the application" (the tour): the workspace brings a tab of the module to the front. */
export const moduleRequest = atom<{ kind: ModuleKind; at: number } | null>(null);

export function openModule(kind: ModuleKind): void {
  moduleRequest.set({ kind, at: performance.now() });
}
