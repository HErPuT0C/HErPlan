// Editing helpers of the document editor (0.7.4).
//
// A heading made from a selection: words selected in the middle of a paragraph become a heading of their own
// (the paragraph is cut before and after them), instead of the whole paragraph turning into a heading — the
// owner's report: "select one word as a heading and all the words after it become big too".

import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

type Level = 1 | 2 | 3;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    selectionHeading: { headingOfSelection: (level: Level) => ReturnType };
  }
}

export const SelectionHeading = Extension.create({
  name: 'selectionHeading',
  // Before the heading's own Ctrl+Alt+1…3.
  priority: 150,
  addCommands() {
    return {
      headingOfSelection:
        (level) =>
        ({ state, tr, dispatch, commands }) => {
          const { from, to, empty, $from, $to } = state.selection;
          const block = $from.parent;
          const whole = $from.parentOffset === 0 && $to.parentOffset === block.content.size;
          // A cursor, a whole block, several blocks, or a heading of this level already: as before.
          if (
            empty ||
            whole ||
            !$from.sameParent($to) ||
            (block.type.name !== 'paragraph' && block.type.name !== 'heading') ||
            (block.type.name === 'heading' && block.attrs.level === level)
          )
            return commands.toggleHeading({ level });
          if (!dispatch) return true;
          // Spaces at the edges of the selection (a double click takes the space after a word) stay out of
          // the heading; the spaces where the paragraph is cut go.
          const blockStart = $from.start();
          const text = block.textBetween(0, block.content.size, '\ufffc', '\ufffc');
          let a = from - blockStart;
          let b = to - blockStart;
          while (a < b && /\s/.test(text[a])) a++;
          while (b > a && /\s/.test(text[b - 1])) b--;
          if (a === b) return commands.toggleHeading({ level });
          let afterEnd = b;
          while (afterEnd < text.length && /\s/.test(text[afterEnd])) afterEnd++;
          let beforeStart = a;
          while (beforeStart > 0 && /\s/.test(text[beforeStart - 1])) beforeStart--;
          if (afterEnd > b) tr.delete(blockStart + b, blockStart + afterEnd);
          if (afterEnd < text.length) tr.split(blockStart + b);
          if (beforeStart < a) tr.delete(blockStart + beforeStart, blockStart + a);
          if (beforeStart > 0) tr.split(blockStart + beforeStart);
          const start = tr.mapping.map(blockStart + a, 1);
          const end = tr.mapping.map(blockStart + b, -1);
          tr.setBlockType(start, end, state.schema.nodes.heading, { level });
          tr.setSelection(TextSelection.create(tr.doc, start, end));
          dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-1': () => this.editor.commands.headingOfSelection(1),
      'Mod-Alt-2': () => this.editor.commands.headingOfSelection(2),
      'Mod-Alt-3': () => this.editor.commands.headingOfSelection(3),
    };
  },
});
