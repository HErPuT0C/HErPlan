// A comment or a note with effects written in it ("x = 1" counts when the option is chosen): the words that
// change a variable are highlighted (0.8.5: shared by the side panel and the window of an option).

import { useId } from 'react';
import { useStore } from '../../core/useStore';
import { knownNames } from '../../story/usage';
import { useStory } from './context';
import { MarkedTextArea, textHighlights, useTextMenu } from './MarkedText';

/** Names that are variables as seen from the graph on the canvas (effects written without braces). */
export function useKnown(): (name: string) => boolean {
  const { project, graphId } = useStory();
  const data = useStore(project.store, (s) => s);
  return knownNames(data, graphId);
}

/** A note with effects in it, highlighted. */
export function NoteField({
  label,
  field,
  value,
  rows,
  onChange,
}: {
  label: string;
  field: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  const { project } = useStory();
  const id = useId();
  const known = useKnown();
  const menu = useTextMenu({ readOnly: project.readOnly });
  return (
    <div className="field" data-field={field}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <MarkedTextArea
        id={id}
        value={value}
        highlights={textHighlights(value, undefined, undefined, known)}
        rows={rows}
        readOnly={project.readOnly}
        onContextMenu={menu.onContextMenu}
        onChange={(e) => onChange(e.target.value)}
      />
      {menu.menu}
    </div>
  );
}
