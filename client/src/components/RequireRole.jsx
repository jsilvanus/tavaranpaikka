import { hasRole, useMe } from '../MeContext.jsx';
import { t } from '../i18n/index.js';
import LoginRequired from './LoginRequired.jsx';

/** Render children only when the user has at least the given role. */
export default function RequireRole({ min = 'keeper', children }) {
  const { me, loading, role } = useMe();
  if (loading) return <p>{t('app.loading')}</p>;
  if (!me?.user) return <LoginRequired />;
  if (!hasRole(role, min)) {
    return (
      <div className="error-box" role="alert">
        {t('app.forbidden')}
      </div>
    );
  }
  return children;
}
