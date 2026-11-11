import { CircleAlert, CircleCheck, PenLine } from 'lucide-react';
import { t, type MessageKey } from '../../i18n';
import type { TransferState } from '../../story/transfer';
import './game.css';

const NAMES: Record<TransferState, MessageKey> = {
  inGame: 'transfer.inGame',
  changed: 'transfer.changed',
  error: 'transfer.error',
};
const HINTS: Record<TransferState, MessageKey> = {
  inGame: 'transfer.inGameHint',
  changed: 'transfer.changedHint',
  error: 'transfer.errorHint',
};
const ICONS: Record<TransferState, typeof CircleCheck> = { inGame: CircleCheck, changed: PenLine, error: CircleAlert };

/**
 * Where a conversation or a node stands with the game (0.8): in the game, changed since it was carried
 * over, or the game could not take it (what it said is shown on hover).
 */
export function TransferBadge({
  state,
  problems = [],
  compact,
}: {
  state: TransferState;
  problems?: string[];
  /** On canvas cards: the icon alone. */
  compact?: boolean;
}) {
  const Icon = ICONS[state];
  const title = state === 'error' && problems.length ? problems.join('\n') : t(HINTS[state]);
  return (
    <span className={`transfer transfer-${state}`} title={title} aria-label={`${t(NAMES[state])}. ${title}`}>
      <Icon size={compact ? 12 : 13} aria-hidden="true" />
      {!compact && <span>{t(NAMES[state])}</span>}
    </span>
  );
}
