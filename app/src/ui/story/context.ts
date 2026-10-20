// What story cards and panels share: the open project and a few editor actions, plus an index of the
// story (plot links pointing at each node, problems per node) rebuilt after changes.

import { createContext, useContext } from 'react';
import { atom } from '../../core/atom';
import type { GraphDoc } from '../../canvas/model';
import type { ProjectData } from '../../core/project/types';
import type { Problem, Severity } from '../../story/checks';
import type { NodeRef, PlotDevice } from '../../story/model';
import type { OpenProject } from '../../state/project';

export interface StoryActions {
  project: OpenProject;
  /** The graph on the canvas now. */
  graphId: string;
  /** Opens a graph and shows a node in it (jump targets, links, problems); `field`: opens it in the inspector. */
  show: (ref: NodeRef, field?: string) => void;
  /** Opens a chapter node's graph. */
  openChapter: (nodeId: string) => void;
  /** Shows the inspector for a node, optionally focusing one field. */
  inspect: (nodeId: string, field?: string) => void;
  /** One undoable change of the graph on the canvas (and the project around it); nothing when read-only. */
  edit: (label: string, recipe: (g: GraphDoc, project: ProjectData) => void, mergeKey?: string) => void;
}

export const StoryContext = createContext<StoryActions | null>(null);

export function useStory(): StoryActions {
  const value = useContext(StoryContext);
  if (!value) throw new Error('story context is missing');
  return value;
}

export interface IncomingLink {
  kind: PlotDevice;
  from: NodeRef;
  title: string;
  /** The mark it comes from (absent for a gun or butterfly node). */
  mark?: string;
}

export interface StoryIndex {
  /** Plot links pointing at each node, by "graph/node". */
  incoming: Map<string, IncomingLink[]>;
  /** The worst problem of each node, by "graph/node". */
  worst: Map<string, Severity>;
  problems: Problem[];
}

export const storyIndex = atom<StoryIndex>({ incoming: new Map(), worst: new Map(), problems: [] });
