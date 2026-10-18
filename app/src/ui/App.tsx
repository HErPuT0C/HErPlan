import { t } from '../i18n';
import './app.css';

export function App() {
  return (
    <main className="splash">
      <h1>{t('app.name')}</h1>
      <p className="tagline">{t('app.tagline')}</p>
      <p className="status">{t('app.status', { version: __APP_VERSION__ })}</p>
    </main>
  );
}
