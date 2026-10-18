import { t } from '../../i18n';
import type { ModuleKind } from '../../state/workspace';
import { EmptyState } from '../components';
import { MODULES } from './modules';

/** Until an editor is built (phases F2–F6), its tab explains when it arrives. */
export function ModulePlaceholder({ kind }: { kind: ModuleKind }) {
  const m = MODULES[kind];
  const Icon = m.icon;
  return (
    <div className="module-placeholder">
      <EmptyState
        icon={<Icon size={48} strokeWidth={1.4} />}
        title={t(m.title)}
        text={
          <>
            {t(m.description)}
            <br />
            {t('module.placeholder', { version: m.release })}
          </>
        }
      />
    </div>
  );
}
