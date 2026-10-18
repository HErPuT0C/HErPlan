import { CircleAlert, CircleCheck, CircleDot } from 'lucide-react';
import type { Autosaver } from '../../core/project/autosave';
import { useAtom } from '../../core/useStore';
import { formatDate, t } from '../../i18n';
import { Button, Spinner, Tooltip } from '../components';
import { errorText } from '../errors';

/** Save indicator in the project header (FR-SAV-02): saved / saving / unsaved / error with a retry. */
export function SaveStatus({ saver }: { saver: Autosaver | null }) {
  if (!saver) {
    return <span className="save-status save-readonly">{t('save.readOnly')}</span>;
  }
  return <LiveSaveStatus saver={saver} />;
}

function LiveSaveStatus({ saver }: { saver: Autosaver }) {
  const state = useAtom(saver.state);
  const savedAt = state.lastSavedAt ? t('save.savedAt', { date: formatDate(state.lastSavedAt) }) : t('save.allSaved');

  if (state.status === 'error') {
    return (
      <span className="save-status save-error" role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{t('save.failed', { reason: errorText(state.error) })}</span>
        <Button size="sm" variant="ghost" onClick={() => void saver.flush().catch(() => undefined)}>
          {t('common.retry')}
        </Button>
      </span>
    );
  }
  const view = {
    saved: { icon: <CircleCheck size={16} aria-hidden="true" />, text: t('save.saved') },
    pending: { icon: <CircleDot size={16} aria-hidden="true" />, text: t('save.pending') },
    saving: { icon: <Spinner size={16} />, text: t('save.saving') },
  }[state.status];
  return (
    <Tooltip text={savedAt}>
      <span className={`save-status save-${state.status}`} tabIndex={0} role="status">
        {view.icon}
        <span>{view.text}</span>
      </span>
    </Tooltip>
  );
}
