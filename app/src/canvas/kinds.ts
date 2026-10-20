// Node kinds and their ports. Generic kinds live here; story kinds (dialogue, choice, condition,
// Chekhov's gun…) register themselves from story/kinds.ts.

import type { MessageKey } from '../i18n';
import { HEADER_H, type GraphNode } from './model';

/** "in" ports only receive edges, "out" ports only start them, "both" do either. */
export type PortSide = 'in' | 'out' | 'both';
export type PortFace = 'left' | 'right' | 'top' | 'bottom';

export interface Port {
  id: string;
  side: PortSide;
  /** The side of the node the port sits on: edges leave and enter perpendicular to it. */
  face: PortFace;
  /** Offset from the node's top-left corner, world units. */
  x: number;
  y: number;
  /** One of the four side anchors: shown only on hover or when connected. */
  anchor?: boolean;
  /** Short text next to the port ("yes", "no"). */
  label?: MessageKey;
}

/** A dashed reference from a node to another node (plot devices), drawn under the cards. */
export interface KindLink {
  /** Tells the links of one node apart (a mark id). */
  key: string;
  to: { graph: string; node: string };
  color: string;
  /** Leaves the left or right side at this offset from the top (a dialogue line, an option row). */
  y?: number;
  /** A wide translucent trail under the dashes. */
  trail?: boolean;
}

export interface NodeKindDef {
  id: string;
  label: MessageKey;
  /** Header colour when the node has no colour of its own. */
  color: string;
  size: { w: number; h: number };
  ports: (node: GraphNode) => Port[];
  /** Drawn as a note: no header, the text fills the card. */
  sticker?: boolean;
  /** Fits the node's size to its content (dialogue lines, choice options) after a change. */
  fit?: (node: GraphNode) => void;
  /** Offered in the create menus of these graph kinds; omitted means everywhere. */
  graphs?: readonly string[];
  /** References to other nodes; without it, the node's `links` field in the kind's colour. */
  links?: (node: GraphNode) => KindLink[];
  /** Not offered in create menus: kept so that older projects still open (gun and butterfly nodes). */
  hidden?: boolean;
  /** Order and grouping in the create menu. */
  menu?: { group: 'basic' | 'flow' | 'logic' | 'plot' | 'world'; order: number };
}

export const FACE_DIR: Record<PortFace, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

export const OPPOSITE_FACE: Record<PortFace, PortFace> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** Vertical middle of the body, below the header: where the side anchors sit. */
export function bodyMiddle(node: Pick<GraphNode, 'h'>, header = HEADER_H): number {
  return header + (node.h - header) / 2;
}

/**
 * The four side anchors (FR-CNV-02): an edge can be pulled from any side of a node. The left and right
 * anchors keep the ids "in" and "out" that format v1 graphs already use.
 */
export function sideAnchors(
  node: Pick<GraphNode, 'w' | 'h'>,
  side: PortSide = 'both',
  faces: readonly PortFace[] = ['left', 'top', 'right', 'bottom'],
  header = HEADER_H,
): Port[] {
  const y = bodyMiddle(node, header);
  const all: Record<PortFace, Port> = {
    left: { id: 'in', side, face: 'left', x: 0, y, anchor: true },
    top: { id: 'top', side, face: 'top', x: node.w / 2, y: 0, anchor: true },
    right: { id: 'out', side, face: 'right', x: node.w, y, anchor: true },
    bottom: { id: 'bottom', side, face: 'bottom', x: node.w / 2, y: node.h, anchor: true },
  };
  return faces.map((f) => all[f]);
}

const KINDS = new Map<string, NodeKindDef>();

export function registerKind(def: NodeKindDef): void {
  KINDS.set(def.id, def);
}

registerKind({
  id: 'node',
  label: 'canvas.kind.node',
  color: '#5b6474',
  size: { w: 240, h: 120 },
  ports: (n) => sideAnchors(n),
  menu: { group: 'basic', order: 0 },
});
registerKind({
  id: 'sticker',
  label: 'canvas.kind.sticker',
  color: '#b88a1e',
  size: { w: 200, h: 140 },
  ports: () => [],
  sticker: true,
  menu: { group: 'basic', order: 1 },
});

/** Unknown kinds (from a newer version or a removed plugin) still render as generic nodes. */
export function kindOf(kind: string): NodeKindDef {
  return KINDS.get(kind) ?? KINDS.get('node')!;
}

/** Kinds offered when creating a node in a graph of this kind, in menu order. */
export function creatableKinds(graphKind?: string): NodeKindDef[] {
  const groups = ['basic', 'flow', 'logic', 'plot', 'world'];
  return [...KINDS.values()]
    .filter((k) => !k.hidden && (!k.graphs || !graphKind || k.graphs.includes(graphKind)))
    .sort((a, b) => {
      const ga = groups.indexOf(a.menu?.group ?? 'basic');
      const gb = groups.indexOf(b.menu?.group ?? 'basic');
      return ga - gb || (a.menu?.order ?? 0) - (b.menu?.order ?? 0);
    });
}

export function portsOf(node: GraphNode): Port[] {
  return kindOf(node.kind).ports(node);
}

export function findPort(node: GraphNode, portId: string): Port | undefined {
  return portsOf(node).find((p) => p.id === portId);
}

export interface PortPlace {
  x: number;
  y: number;
  face: PortFace;
}

/** World position of a port and the side it faces. */
export function portPosition(node: GraphNode, portId: string): PortPlace | null {
  const port = findPort(node, portId);
  return port ? { x: node.x + port.x, y: node.y + port.y, face: port.face } : null;
}

export const canStart = (p: Port): boolean => p.side !== 'in';
export const canEnd = (p: Port): boolean => p.side !== 'out';
