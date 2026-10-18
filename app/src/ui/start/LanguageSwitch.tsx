import { Languages } from 'lucide-react';
import { LOCALES, useLocale, type Locale } from '../../i18n';
import { updateSettings } from '../../state/settings';
import { MenuButton } from '../components';

export const LOCALE_NAMES: Record<Locale, string> = { ru: 'Русский', en: 'English' };

export function LanguageSwitch() {
  const locale = useLocale();
  return (
    <MenuButton
      variant="ghost"
      size="sm"
      label={LOCALE_NAMES[locale]}
      icon={<Languages size={16} aria-hidden="true" />}
      entries={LOCALES.map((l) => ({
        id: l,
        label: LOCALE_NAMES[l],
        onSelect: () => updateSettings((s) => ({ ...s, locale: l })),
      }))}
    />
  );
}
