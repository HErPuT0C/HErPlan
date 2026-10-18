import { Bug, FileText } from 'lucide-react';
import { useState } from 'react';
import { buildReport, recentLog } from '../../core/log';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { settings } from '../../state/settings';
import { Button, Dialog, TextArea, toast } from '../components';
import { errorText } from '../errors';

const ISSUES_URL = 'https://github.com/HErPuT0C/HErPlan/issues/new';

/** GPU name as WebGL reports it: canvas problems usually depend on it (ADR-002). */
function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'WebGL unavailable';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return 'unknown';
  }
}

/** Offline bug report (FR-APP-07): a text file with versions, settings and the recent log; nothing is sent. */
export function ReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Report onClose={onClose} /> : null;
}

function Report({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const collect = async () => {
    const p = platform();
    const system = {
      ...(await p.systemInfo().catch(() => ({}))),
      gpu: gpuName(),
      screen: `${screen.width}×${screen.height} @${devicePixelRatio}`,
    };
    // Recent project paths may contain the user name; the report keeps only their number.
    const { recentProjects, ...rest } = settings.get();
    return {
      system,
      settings: { ...rest, projectsDir: rest.projectsDir ? '(set)' : null, recentProjects: recentProjects.length },
    };
  };

  const save = async () => {
    setBusy(true);
    try {
      const { system, settings: summary } = await collect();
      const text = buildReport({ version: __APP_VERSION__, system, settings: summary, log: recentLog(), description });
      const path = await platform().saveReport(text);
      toast({
        kind: 'success',
        text: t('report.saved', { path }),
        action: { label: t('common.revealInExplorer'), run: () => void platform().revealInExplorer(path) },
      });
      onClose();
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const openIssue = async () => {
    const { system } = await collect();
    const body = [
      description.trim() || t('report.issueDescribe'),
      '',
      `HErPlan ${__APP_VERSION__}`,
      ...Object.entries(system).map(([k, v]) => `${k}: ${v}`),
      '',
      t('report.issueAttach'),
    ].join('\n');
    const url = `${ISSUES_URL}?labels=bug&body=${encodeURIComponent(body)}`;
    await platform().openUrl(url);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('report.title')}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" icon={<Bug size={16} />} onClick={() => void openIssue()}>
            {t('report.openIssue')}
          </Button>
          <Button variant="primary" icon={<FileText size={16} />} busy={busy} onClick={() => void save()}>
            {t('report.save')}
          </Button>
        </>
      }
    >
      <p className="muted">{t('report.intro')}</p>
      <TextArea
        label={t('report.description')}
        placeholder={t('report.descriptionPlaceholder')}
        rows={5}
        value={description}
        autoFocus
        onChange={(e) => setDescription(e.target.value)}
      />
      <p className="muted small">{t('report.contents')}</p>
    </Dialog>
  );
}
