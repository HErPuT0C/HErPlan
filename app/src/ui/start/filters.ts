import { t } from '../../i18n';

export const IMAGE_FILTERS = [{ name: 'PNG, JPEG, WebP, GIF', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }];

export function zipFilters() {
  return [{ name: t('import.zipFilter'), extensions: ['zip'] }];
}
