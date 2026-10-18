import { APP_BUILD, APP_VERSION } from '../core/version';
import { t } from '../i18n';

/** "HErPlan 0.2.0", or "HErPlan 0.2.0 · сборка 57" for a build between releases. */
export function versionText(): string {
  return APP_BUILD
    ? t('app.versionBuild', { version: APP_VERSION, build: APP_BUILD })
    : t('app.versionLine', { version: APP_VERSION });
}
