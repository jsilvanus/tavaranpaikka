import { withBasePath } from '../api/client.js';
import { t } from '../i18n/index.js';

export default function LoginRequired() {
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  return (
    <div className="error-box" role="alert">
      <p>{t('app.loginRequired')}</p>
      <a href={withBasePath('/api/auth/login?returnTo=' + returnTo)} className="btn btn-sm">
        {t('app.footer.login')}
      </a>
    </div>
  );
}
