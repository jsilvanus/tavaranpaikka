import { t } from '../i18n/index.js';

export default function PrivacyPage() {
  return (
    <section className="card">
      <h1 style={{ margin: '0 0 0.75rem 0', fontSize: '1.5rem' }}>{t('privacy.title')}</h1>
      <p style={{ margin: 0 }}>{t('privacy.body')}</p>
    </section>
  );
}
