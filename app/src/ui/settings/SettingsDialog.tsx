import { Bug, Check, ExternalLink, Gauge, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { BackupKeep } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { LOCALES, t, type MessageKey } from '../../i18n';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { ACCENTS, settings, UI_SCALES, updateSettings, type Accent } from '../../state/settings';
import { Button, Dialog, SelectField, TabPanel, Tabs, TextField } from '../components';
import { HOTKEYS } from '../hotkeys';
import { ReportDialog } from '../report/ReportDialog';
import { LOCALE_NAMES } from '../start/LanguageSwitch';
import { versionText } from '../version';

export const REPO_URL = 'https://github.com/HErPuT0C/HErPlan';
const ISSUES_URL = `${REPO_URL}/issues/new`;

type Section = 'general' | 'appearance' | 'editor' | 'project' | 'hotkeys' | 'about';

const ACCENT_NAMES: Record<Accent, MessageKey> = {
  mint: 'settings.accent.mint',
  indigo: 'settings.accent.indigo',
  amber: 'settings.accent.amber',
};
const ACCENT_COLORS: Record<Accent, string> = { mint: '#34c9a5', indigo: '#7b86ff', amber: '#f0a43c' };

/** Settings (FR-APP-02): application settings, plus the open project's own settings. */
export function SettingsDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: OpenProject;
}) {
  const [section, setSection] = useState<Section>('general');
  const sections: { value: Section; label: string }[] = [
    { value: 'general', label: t('settings.general') },
    { value: 'appearance', label: t('settings.appearance') },
    { value: 'editor', label: t('settings.editor') },
    ...(project ? [{ value: 'project' as const, label: t('settings.project') }] : []),
    { value: 'hotkeys', label: t('settings.hotkeys') },
    { value: 'about', label: t('settings.about') },
  ];
  const current = sections.some((s) => s.value === section) ? section : 'general';

  return (
    <Dialog open={open} onClose={onClose} title={t('settings.title')} size="lg">
      <Tabs items={sections} value={current} onChange={setSection} label={t('settings.title')} idPrefix="settings" />
      <TabPanel idPrefix="settings" value={current}>
        {current === 'general' && <GeneralSettings />}
        {current === 'appearance' && <AppearanceSettings />}
        {current === 'editor' && <EditorSettings />}
        {current === 'project' && project && <ProjectSettings project={project} />}
        {current === 'hotkeys' && <HotkeyList />}
        {current === 'about' && <About />}
      </TabPanel>
    </Dialog>
  );
}

function GeneralSettings() {
  const s = useAtom(settings);
  return (
    <>
      <SelectField
        label={t('settings.language')}
        value={s.locale}
        options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
        onChange={(locale) => updateSettings((x) => ({ ...x, locale }))}
      />
      <SelectField
        label={t('settings.dashboardView')}
        value={s.dashboardView}
        options={[
          { value: 'cards', label: t('settings.dashboardView.cards') },
          { value: 'list', label: t('settings.dashboardView.list') },
        ]}
        onChange={(dashboardView) => updateSettings((x) => ({ ...x, dashboardView }))}
      />
    </>
  );
}

function AppearanceSettings() {
  const s = useAtom(settings);
  return (
    <>
      <fieldset className="accent-picker">
        <legend className="field-label">{t('settings.accent')}</legend>
        <div className="accent-options" role="radiogroup" aria-label={t('settings.accent')}>
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={s.accent === accent}
              className="accent-option"
              onClick={() => updateSettings((x) => ({ ...x, accent }))}
            >
              <span className="accent-swatch" style={{ background: ACCENT_COLORS[accent] }}>
                {s.accent === accent && <Check size={16} aria-hidden="true" />}
              </span>
              <span>{t(ACCENT_NAMES[accent])}</span>
            </button>
          ))}
        </div>
        <span className="field-hint">{t('settings.accentHint')}</span>
      </fieldset>
      <SelectField
        label={t('settings.uiScale')}
        value={s.uiScale}
        options={UI_SCALES.map((v) => ({ value: v, label: `${v} %` }))}
        onChange={(uiScale) => updateSettings((x) => ({ ...x, uiScale }))}
        hint={t('settings.uiScaleHint')}
      />
    </>
  );
}

function EditorSettings() {
  const s = useAtom(settings);
  return (
    <>
      <SelectField
        label={t('settings.panButton')}
        value={s.panButton}
        options={[
          { value: 'middle', label: t('settings.panButton.middle') },
          { value: 'right', label: t('settings.panButton.right') },
        ]}
        onChange={(panButton) => updateSettings((x) => ({ ...x, panButton }))}
        hint={t('settings.panButtonHint')}
      />
      <SelectField
        label={t('settings.canvasQuality')}
        value={s.canvasQuality}
        options={[
          { value: 'normal', label: t('settings.canvasQuality.normal') },
          { value: 'economy', label: t('settings.canvasQuality.economy') },
        ]}
        onChange={(canvasQuality) => updateSettings((x) => ({ ...x, canvasQuality }))}
        hint={t('settings.canvasQualityHint')}
      />
      <SelectField
        label={t('settings.autosave')}
        value={s.autosaveSeconds}
        options={[1, 2, 5, 10, 30, 60].map((v) => ({ value: v, label: t('settings.seconds', { count: v }) }))}
        onChange={(autosaveSeconds) => updateSettings((x) => ({ ...x, autosaveSeconds }))}
        hint={t('settings.autosaveHint')}
      />
    </>
  );
}

function ProjectSettings({ project }: { project: OpenProject }) {
  const { store, readOnly } = project;
  const backups = useStore(store, (s) => s.meta.settings.backups);
  const limits = useStore(store, (s) => s.meta.settings.dialogueLimits);
  const keepOptions: { value: string; label: string }[] = [10, 20, 50, 100, 200].map((n) => ({
    value: String(n),
    label: t('settings.keepLast', { count: n }),
  }));
  keepOptions.push({ value: 'all', label: t('settings.keepAll') });
  if (backups.keep !== 'all' && !keepOptions.some((o) => o.value === String(backups.keep))) {
    keepOptions.unshift({ value: String(backups.keep), label: t('settings.keepLast', { count: backups.keep }) });
  }

  const setLimit = (key: 'maxLines' | 'maxLineChars', raw: string) => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 100_000) return;
    store.dispatch(
      t('history.step.limits'),
      (d) => {
        d.meta.settings.dialogueLimits[key] = value;
      },
      { mergeKey: `limits.${key}` },
    );
  };

  return (
    <>
      <p className="muted small">{t('settings.projectHint')}</p>
      <SelectField
        label={t('settings.backupKeep')}
        value={String(backups.keep)}
        disabled={readOnly}
        options={keepOptions}
        onChange={(v) => {
          const keep: BackupKeep = v === 'all' ? 'all' : Number(v);
          store.dispatch(t('history.step.backupPolicy'), (d) => {
            d.meta.settings.backups.keep = keep;
          });
        }}
      />
      <SelectField
        label={t('settings.backupInterval')}
        value={backups.intervalMinutes}
        disabled={readOnly}
        options={[5, 10, 15, 30, 60].map((v) => ({ value: v, label: t('settings.minutes', { count: v }) }))}
        onChange={(intervalMinutes) =>
          store.dispatch(t('history.step.backupPolicy'), (d) => {
            d.meta.settings.backups.intervalMinutes = intervalMinutes;
          })
        }
        hint={t('settings.backupIntervalHint')}
      />
      <div className="field-row">
        <TextField
          label={t('settings.maxLines')}
          type="number"
          min={1}
          disabled={readOnly}
          defaultValue={limits.maxLines}
          onChange={(e) => setLimit('maxLines', e.target.value)}
        />
        <TextField
          label={t('settings.maxLineChars')}
          type="number"
          min={1}
          disabled={readOnly}
          defaultValue={limits.maxLineChars}
          onChange={(e) => setLimit('maxLineChars', e.target.value)}
        />
      </div>
      <span className="field-hint">{t('settings.limitsHint')}</span>
    </>
  );
}

function HotkeyList() {
  return (
    <table className="hotkey-table">
      <tbody>
        {HOTKEYS.map((h) => (
          <tr key={h.id}>
            <td>{t(h.label)}</td>
            <td>
              {h.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="muted">{t('hotkey.or')}</span>}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function About() {
  const p = platform();
  const [reporting, setReporting] = useState(false);
  return (
    <div className="about">
      <p>{versionText()}</p>
      <p className="muted">{t('settings.aboutText')}</p>
      <div className="about-actions">
        <Button icon={<MessageSquare size={16} />} onClick={() => void p.openUrl(`${ISSUES_URL}?labels=feedback`)}>
          {t('settings.feedback')}
        </Button>
        <Button icon={<Bug size={16} />} onClick={() => setReporting(true)}>
          {t('settings.reportBug')}
        </Button>
        <Button variant="ghost" icon={<ExternalLink size={16} />} onClick={() => void p.openUrl(REPO_URL)}>
          {t('settings.sourceCode')}
        </Button>
        <Button
          variant="ghost"
          icon={<Gauge size={16} />}
          onClick={() => (window.location.hash = '#/dev/canvas-bench')}
        >
          {t('bench.title')}
        </Button>
      </div>
      <ReportDialog open={reporting} onClose={() => setReporting(false)} />
    </div>
  );
}
