import { useState } from 'react';

/**
 * Text that is saved as you type but may be invalid for a moment (an empty name, a name already taken).
 * While the field has focus it shows what was typed; otherwise it shows the stored value, so undo and
 * changes from elsewhere are never hidden behind a stale copy.
 */
export function useDraft(stored: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? stored,
    setValue: setDraft,
    onFocus: () => setDraft(stored),
    onBlur: () => setDraft(null),
  };
}
