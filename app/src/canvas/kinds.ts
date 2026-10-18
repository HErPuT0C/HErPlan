// Node kinds and their ports. Phase F2 has the generic kinds every canvas needs;
// story kinds (dialogue, choice, condition, Chekhov's gun…) register here in phase F3.

import type { MessageKey } from '../i18n';
import { HEADER_H, type GraphNode } from './model';

export type PortSide = 'in' | 'out';

export interface Port {
  id: string;
  side: PortSide;
  /** Offset from the node's top edge, in world units. */
  y: number;
}

export interface NodeKindDef {
  id: string;
  label: MessageKey;
  /** Header colour when the node has no colour of its own. */
  color: string;
  size: { w: number; h: number };
  /** Stickers and frames have no ports and no header. */
  ports: (node: GraphNode) => Port[];
  /** Drawn as a note: no header, the text fills the card. */
  sticker?: boolean;
}

const centerPorts = (node: GraphNode): Port[] => {
  const y = HEADER_H + (node.h - HEADER_H) / 2;
  return [
    { id: 'in', side: 'in', y },
    { id: 'out', side: 'out', y },
  ];
};

const KINDS = new Map<string, NodeKindDef>();

export function registerKind(def: NodeKindDef): void {
  KINDS.set(def.id, def);
}

registerKind({ id: 'node', label: 'canvas.kind.node', color: '#5b6474', size: { w: 240, h: 120 }, ports: centerPorts });
registerKind({
  id: 'sticker',
  label: 'canvas.kind.sticker',
  color: '#b88a1e',
  size: { w: 200, h: 140 },
  ports: () => [],
  sticker: true,
});

/** Unknown kinds (from a newer version or a removed plugin) still render as generic nodes. */
export function kindOf(kind: string): NodeKindDef {
  return KINDS.get(kind) ?? KINDS.get('node')!;
}

export function creatableKinds(): NodeKindDef[] {
  return [...KINDS.values()];
}

export function portsOf(node: GraphNode): Port[] {
  return kindOf(node.kind).ports(node);
}

/** World position of a port: inputs on the left edge, outputs on the right edge. */
export function portPosition(node: GraphNode, portId: string): { x: number; y: number } | null {
  const port = portsOf(node).find((p) => p.id === portId);
  if (!port) return null;
  return { x: port.side === 'in' ? node.x : node.x + node.w, y: node.y + port.y };
}
