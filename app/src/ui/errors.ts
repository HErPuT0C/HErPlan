import { t, type MessageKey } from '../i18n';
import { isPlatformError, type ErrorCode } from '../platform';

const MESSAGES: Record<ErrorCode, MessageKey> = {
  'disk-full': 'error.disk-full',
  'not-found': 'error.not-found',
  exists: 'error.exists',
  'not-empty': 'error.not-empty',
  'not-a-project': 'error.not-a-project',
  'invalid-path': 'error.invalid-path',
  'permission-denied': 'error.permission-denied',
  'bad-archive': 'error.bad-archive',
  io: 'error.io',
};

/** A message the user can act on; the technical detail goes to the console for bug reports. */
export function errorText(error: unknown): string {
  if (isPlatformError(error)) {
    if (error.code === 'io') console.error(error);
    return t(MESSAGES[error.code] ?? 'error.io');
  }
  console.error(error);
  return t('error.io');
}
