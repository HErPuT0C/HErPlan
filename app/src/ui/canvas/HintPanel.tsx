import { ChevronDown, ChevronUp, Keyboard } from 'lucide-react';
import { useAtom } from '../../core/useStore';
import { t, type MessageKey } from '../../i18n';
import { settings, updateSettings } from '../../state/settings';

/** The same shortcut list on every canvas (FR-CNV-11); folded state is remembered. */
export const CANVAS_HINTS: [keys: (string | MessageKey)[], what: MessageKey][] = [
  [['canvas.key.doubleClick'], 'canvas.hint.create'],
  [['canvas.key.dragPort'], 'canvas.hint.connect'],
  [['canvas.key.dragHandle'], 'canvas.hint.resize'],
  [['Enter'], 'canvas.hint.open'],
  [['canvas.key.spaceDrag', 'canvas.key.middle'], 'canvas.hint.pan'],
  [['canvas.key.wheel'], 'canvas.hint.zoom'],
  [['Shift', 'Ctrl'], 'canvas.hint.addSelect'],
  [['Ctrl+C', 'Ctrl+V', 'Ctrl+D'], 'canvas.hint.copy'],
  [['Del'], 'canvas.hint.delete'],
  [['Ctrl+G'], 'canvas.hint.group'],
  [['F'], 'canvas.hint.fit'],
  [['Ctrl+F'], 'canvas.hint.search'],
  [['Alt'], 'canvas.hint.free'],
];

const keyLabel = (k: string) => (k.startsWith('canvas.key.') ? t(k as MessageKey) : k);

export function HintPanel() {
  const open = useAtom(settings).canvasHintsOpen !== false;
  const toggle = () => updateSettings((s) => ({ ...s, canvasHintsOpen: !open }));
  return (
    <div className={['canvas-hints', open && 'canvas-hints-open'].filter(Boolean).join(' ')} data-canvas-ignore>
      <button type="button" className="canvas-hints-toggle" aria-expanded={open} onClick={toggle}>
        <Keyboard size={14} aria-hidden="true" />
        <span>{t('canvas.hints')}</span>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      </button>
      {open && (
        <dl className="canvas-hints-list">
          {CANVAS_HINTS.map(([keys, what]) => (
            <div key={what} className="canvas-hint">
              <dt>
                {keys.map((k) => (
                  <kbd key={k}>{keyLabel(k)}</kbd>
                ))}
              </dt>
              <dd>{t(what)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
