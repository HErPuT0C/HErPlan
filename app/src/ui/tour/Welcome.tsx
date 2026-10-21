// The first start (0.7): an offer to take the tour on the tutorial project. Whatever is chosen, it is not
// offered again; the tour and the tutorial project stay in the settings ("Learning").

import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { settings, updateSettings } from '../../state/settings';
import { Logo } from '../brand/Logo';
import { Button, Dialog, toast } from '../components';
import { openTutorialProject } from './learning';
import './tour.css';

export function Welcome() {
  const { tourSeen } = useAtom(settings);
  const [busy, setBusy] = useState<'tour' | 'project' | null>(null);
  if (tourSeen) return null;
  const later = () => {
    updateSettings((s) => ({ ...s, tourSeen: true }));
    toast({ kind: 'info', text: t('welcome.later') }, 6000);
  };
  const go = async (withTour: boolean) => {
    setBusy(withTour ? 'tour' : 'project');
    const ok = await openTutorialProject(withTour);
    if (!ok) setBusy(null);
  };
  return (
    <Dialog
      open
      onClose={later}
      title={t('welcome.title')}
      dismissable={busy === null}
      footer={
        <>
          <Button variant="ghost" disabled={busy !== null} onClick={later}>
            {t('welcome.notNow')}
          </Button>
          <Button busy={busy === 'project'} disabled={busy === 'tour'} onClick={() => void go(false)}>
            {t('welcome.projectOnly')}
          </Button>
          <Button
            variant="primary"
            icon={<GraduationCap size={16} />}
            busy={busy === 'tour'}
            disabled={busy === 'project'}
            onClick={() => void go(true)}
          >
            {t('welcome.tour')}
          </Button>
        </>
      }
    >
      <div className="welcome">
        <Logo size={48} />
        <p>{t('welcome.text')}</p>
        <p className="muted small">{t('welcome.hint')}</p>
      </div>
    </Dialog>
  );
}
