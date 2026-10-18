import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { atom } from '../../core/atom';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { IconButton } from './Button';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; run: () => void };
}

const toasts = atom<ToastItem[]>([]);
let nextId = 1;

/** Shows a notification. Errors stay until closed; others disappear after a few seconds. */
export function toast(item: Omit<ToastItem, 'id'>, timeoutMs = item.kind === 'error' ? 0 : 5000): number {
  const id = nextId++;
  toasts.set((list) => [...list.slice(-4), { ...item, id }]);
  if (timeoutMs > 0) setTimeout(() => dismissToast(id), timeoutMs);
  return id;
}

export function dismissToast(id: number): void {
  toasts.set((list) => list.filter((item) => item.id !== id));
}

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert } as const;

export function ToastRegion() {
  const list = useAtom(toasts);
  return (
    <div className="toasts" role="region" aria-label={t('common.notifications')} aria-live="polite">
      {list.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div key={item.id} className={`toast toast-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={18} className="toast-icon" aria-hidden="true" />
            <span className="toast-text">{item.text}</span>
            {item.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismissToast(item.id);
                  item.action?.run();
                }}
              >
                {item.action.label}
              </button>
            )}
            <IconButton
              size="sm"
              label={t('common.close')}
              icon={<X size={14} />}
              onClick={() => dismissToast(item.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
