// How a node kind looks up close beyond the generic card (title and text). Editors built on the canvas
// (the story editor) register bodies and header extras for their kinds; unknown kinds keep the generic card.

import type { ComponentType } from 'react';
import type { GraphNode } from '../../canvas/model';

export interface CardBodyProps {
  node: GraphNode;
  w: number;
  h: number;
  readOnly: boolean;
  onText: (id: string, text: string) => void;
}

export interface CardLook {
  /** Replaces the text area under the header. */
  body?: ComponentType<CardBodyProps>;
  /** Small badges and buttons at the right end of the header. */
  headerExtra?: ComponentType<{ node: GraphNode; readOnly: boolean }>;
  /** The kind's icon in the header when the node has no icon of its own. */
  icon?: ComponentType<{ size?: number }>;
  /** False: double click on the title opens the node (a chapter) instead of renaming it. */
  titleEditable?: boolean;
}

const LOOKS = new Map<string, CardLook>();

export function registerCard(kind: string, look: CardLook): void {
  LOOKS.set(kind, look);
}

export function cardLook(kind: string): CardLook | undefined {
  return LOOKS.get(kind);
}
