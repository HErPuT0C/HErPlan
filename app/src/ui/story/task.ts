// "A task for Claude" (0.8): a ready phrase for the clipboard that says what to carry over into the game —
// a conversation, one node or one line, with names and ids — where its file is, and what changed since it
// was carried over last time.

import type { ProjectData } from '../../core/project/types';
import { t } from '../../i18n';
import { graphKey } from '../../story/gameKey';
import { asStory, graphOf } from '../../story/model';
import { graphFile, transferChanges, type ImportInfo, type TransferChange } from '../../story/transfer';

function changeText(c: TransferChange): string {
  const title = 'title' in c ? c.title || t('story.untitled') : '';
  switch (c.kind) {
    case 'nodeAdded':
      return t('task.change.nodeAdded', { title });
    case 'linesChanged':
      return t('task.change.lines', { title, ids: c.lines.join(', '), count: c.lines.length });
    case 'optionsChanged':
      return t('task.change.options', { title, ids: c.options.join(', '), count: c.options.length });
    case 'nodeChanged':
      return t('task.change.node', { title });
    case 'other':
      return t('task.change.other');
  }
}

/** The phrase, or null when the conversation has no name in the game yet (nothing to ask for). */
export function taskText(
  data: ProjectData,
  graphId: string,
  scope: { node?: string; line?: string },
  info: ImportInfo | undefined,
): string | null {
  const g = graphOf(data, graphId);
  const key = graphKey(g);
  if (!g || !key) return null;
  const file = graphFile(graphId);
  const node = scope.node ? g.nodes.find((n) => n.id === scope.node) : undefined;
  if (node && scope.line) {
    const line = asStory(node).lines?.find((l) => l.id === scope.line);
    return t('task.text.line', {
      key,
      file,
      title: node.title || t('story.untitled'),
      node: node.id,
      line: scope.line,
      text: line?.text ?? '',
    });
  }
  if (node) return t('task.text.node', { key, file, title: node.title || t('story.untitled'), node: node.id });
  const changes = transferChanges(g, info);
  const what = !info ? t('task.first') : changes.length ? changes.map(changeText).join(', ') : t('task.nothingChanged');
  return t('task.text.graph', { key, file, what });
}
