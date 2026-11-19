// Shows the drawing window for a picture or a new drawing (0.9): opening it may take a moment (the picture is
// read), saving writes the picture, and whoever asked is told where it is. Errors become messages, not crashes.

import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { toast } from '../components';
import { errorText } from '../errors';
import { DrawingEditor } from './DrawingEditor';
import type { DrawSession } from './drawFile';

interface Open {
  session: DrawSession;
  onDone: (path: string) => void;
}

/** The window and a way to open it: `draw(load, onDone)` reads, shows, and calls `onDone` with the saved path. */
export function useDrawingWindow(): {
  window: ReactNode;
  draw: (load: () => Promise<DrawSession> | DrawSession, onDone: (path: string) => void) => void;
} {
  const [open, setOpen] = useState<Open | null>(null);
  const draw = (load: () => Promise<DrawSession> | DrawSession, onDone: (path: string) => void) => {
    void Promise.resolve()
      .then(load)
      .then((session) => setOpen({ session, onDone }))
      .catch((e) => toast({ kind: 'error', text: t('draw.cannotOpen', { reason: errorText(e) }) }));
  };
  const window = open ? <Host key={open.session.title} open={open} onClose={() => setOpen(null)} /> : null;
  return { window, draw };
}

function Host({ open, onClose }: { open: Open; onClose: () => void }) {
  const { session } = open;
  useEffect(() => {
    if (session.notice) toast({ kind: 'info', text: session.notice }, 6000);
  }, [session]);
  return (
    <DrawingEditor
      title={session.title}
      drawing={session.drawing}
      background={session.background}
      hint={session.hint}
      onClose={onClose}
      onSave={async (d) => {
        try {
          const path = await session.save(d);
          toast({ kind: 'success', text: t('draw.saved', { name: path.slice(path.lastIndexOf('/') + 1) }) }, 2500);
          open.onDone(path);
          onClose();
        } catch (e) {
          toast({ kind: 'error', text: t('draw.saveFailed', { reason: errorText(e) }) });
        }
      }}
    />
  );
}
