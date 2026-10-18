import { Bell, Copy, Pencil, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../i18n';
import { ACCENTS, updateSettings } from '../../state/settings';
import { Logo } from '../brand/Logo';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  IconButton,
  MenuButton,
  PropertyPanel,
  PropertyRow,
  PropertySection,
  SelectField,
  Spinner,
  Switch,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  toast,
  Tooltip,
  useContextMenu,
} from '../components';
import './showcase.css';

/**
 * Component showcase (F1-04), opened with #/dev/components. Texts are sample data, so they come from
 * the dictionary's "dev.*" keys like everything else.
 */
export function Showcase() {
  const [dialog, setDialog] = useState(false);
  const [check, setCheck] = useState(true);
  const [on, setOn] = useState(false);
  const [tab, setTab] = useState<'a' | 'b'>('a');
  const [select, setSelect] = useState('one');
  const sampleMenu = [
    {
      id: 'edit',
      label: t('dev.rename'),
      icon: <Pencil size={16} />,
      shortcut: 'F2',
      onSelect: () => toast({ kind: 'info', text: t('dev.rename') }),
    },
    { id: 'copy', label: t('dev.duplicate'), icon: <Copy size={16} />, onSelect: () => undefined },
    { id: 'off', label: t('dev.disabled'), disabled: true, onSelect: () => undefined },
    { id: 'sep', separator: true as const },
    { id: 'del', label: t('dev.delete'), icon: <Trash size={16} />, danger: true, onSelect: () => undefined },
  ];
  const context = useContextMenu(t('dev.contextArea'), () => sampleMenu);

  return (
    <div className="showcase">
      <header className="showcase-header">
        <Logo size={28} />
        <h1>{t('dev.title')}</h1>
        <div className="showcase-accents">
          {ACCENTS.map((accent) => (
            <Button key={accent} size="sm" onClick={() => updateSettings((s) => ({ ...s, accent }))}>
              {accent}
            </Button>
          ))}
        </div>
      </header>
      <div className="showcase-body">
        <main className="showcase-main">
          <section>
            <h2>{t('dev.buttons')}</h2>
            <div className="showcase-row">
              <Button variant="primary" icon={<Plus size={16} />}>
                {t('dev.primary')}
              </Button>
              <Button>{t('dev.secondary')}</Button>
              <Button variant="ghost">{t('dev.ghost')}</Button>
              <Button variant="danger">{t('dev.delete')}</Button>
              <Button disabled>{t('dev.disabled')}</Button>
              <Button busy>{t('dev.busy')}</Button>
              <Button size="sm">{t('dev.small')}</Button>
              <IconButton label={t('dev.notify')} icon={<Bell size={18} />} />
              <MenuButton label={t('dev.menu')} entries={sampleMenu} />
            </div>
          </section>
          <section>
            <h2>{t('dev.fields')}</h2>
            <div className="showcase-grid">
              <TextField label={t('dev.textField')} placeholder={t('dev.placeholder')} hint={t('dev.hint')} />
              <TextField label={t('dev.invalidField')} defaultValue="?" error={t('dev.error')} />
              <SelectField
                label={t('dev.select')}
                value={select}
                onChange={setSelect}
                options={[
                  { value: 'one', label: t('dev.optionOne') },
                  { value: 'two', label: t('dev.optionTwo') },
                ]}
              />
              <TextArea label={t('dev.textArea')} rows={2} />
              <Checkbox label={t('dev.checkbox')} checked={check} onChange={setCheck} />
              <Switch label={t('dev.switch')} checked={on} onChange={setOn} />
            </div>
          </section>
          <section>
            <h2>{t('dev.overlays')}</h2>
            <div className="showcase-row">
              <Button onClick={() => setDialog(true)}>{t('dev.openDialog')}</Button>
              <Button onClick={() => toast({ kind: 'info', text: t('dev.toastInfo') })}>{t('dev.toast')}</Button>
              <Button onClick={() => toast({ kind: 'success', text: t('dev.toastSuccess') })}>
                {t('dev.toastSuccessButton')}
              </Button>
              <Button
                onClick={() =>
                  toast({
                    kind: 'error',
                    text: t('dev.toastError'),
                    action: { label: t('common.retry'), run: () => undefined },
                  })
                }
              >
                {t('dev.toastErrorButton')}
              </Button>
              <Tooltip text={t('dev.tooltipText')}>
                <Button>{t('dev.tooltip')}</Button>
              </Tooltip>
              <Spinner />
            </div>
            <div className="showcase-context" onContextMenu={context.onContextMenu} tabIndex={0}>
              {t('dev.contextArea')}
            </div>
            {context.menu}
          </section>
          <section>
            <h2>{t('dev.tabs')}</h2>
            <Tabs
              items={[
                { value: 'a', label: t('dev.tabA') },
                { value: 'b', label: t('dev.tabB') },
              ]}
              value={tab}
              onChange={setTab}
              label={t('dev.tabs')}
              idPrefix="showcase"
            />
            <TabPanel idPrefix="showcase" value={tab}>
              <p>{tab === 'a' ? t('dev.tabAText') : t('dev.tabBText')}</p>
            </TabPanel>
          </section>
          <section>
            <h2>{t('dev.empty')}</h2>
            <EmptyState
              title={t('dev.emptyTitle')}
              text={t('dev.emptyText')}
              actions={<Button variant="primary">{t('dev.primary')}</Button>}
            />
          </section>
        </main>
        <PropertyPanel title={t('dev.properties')}>
          <PropertySection title={t('dev.sectionMain')}>
            <PropertyRow label={t('dev.textField')}>
              <input className="input" defaultValue={t('dev.sampleName')} />
            </PropertyRow>
            <PropertyRow label={t('dev.checkbox')}>
              <Checkbox label="" checked={check} onChange={setCheck} aria-label={t('dev.checkbox')} />
            </PropertyRow>
          </PropertySection>
          <PropertySection title={t('dev.sectionMore')} defaultOpen={false}>
            <PropertyRow label={t('dev.select')}>
              <span className="muted">{t('dev.optionOne')}</span>
            </PropertyRow>
          </PropertySection>
        </PropertyPanel>
      </div>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title={t('dev.dialogTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              {t('dev.primary')}
            </Button>
          </>
        }
      >
        <p>{t('dev.dialogText')}</p>
        <TextField label={t('dev.textField')} autoFocus />
      </Dialog>
    </div>
  );
}
