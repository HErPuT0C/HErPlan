import { t } from '../i18n';
import { Logo } from './brand/Logo';
import './app.css';

export function App() {
  return (
    <main className="splash">
      <h1 aria-label={t('app.name')}>
        <Logo size={48} />
      </h1>
      <p className="tagline">{t('app.tagline')}</p>
      <p className="status">{t('app.status', { version: __APP_VERSION__ })}</p>
    </main>
  );
}
