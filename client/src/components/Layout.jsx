import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { t } from '../i18n/index.js';
import { getDevRole, setDevRole, withBasePath } from '../api/client.js';
import { hasRole, useMe } from '../MeContext.jsx';
import styles from './Layout.module.css';

export default function Layout({ children }) {
  const [role, setRole] = useState(() => getDevRole());
  const { me, role: myRole, refresh } = useMe();
  const canManage = hasRole(myRole, 'keeper');

  function handleRoleChange(e) {
    const next = e.target.value;
    setRole(next);
    setDevRole(next);
    refresh();
  }

  async function handleOrgChange(e) {
    const nextOrgId = e.target.value;
    try {
      const res = await fetch(withBasePath('/api/auth/switch-org'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: nextOrgId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // ignore network error
    }
  }

  const showDevSelector = import.meta.env.DEV || me?.authMode === 'dev';
  const orgs = Array.isArray(me?.organizations) ? me.organizations : [];
  const showOrgSwitcher = orgs.length > 1;

  return (
    <div className={styles.shell}>
      <header className={`${styles.header} no-print`}>
        <div className={styles.headerInner}>
          <Link to="/storages" className={styles.brand}>
            {t('app.name')}
          </Link>
          <nav className={styles.nav} aria-label={t('app.name')}>
            <NavLink
              to="/storages"
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              {t('app.nav.storages')}
            </NavLink>
            {canManage ? (
              <>
            <NavLink
              to="/manage"
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              {t('app.nav.manage')}
            </NavLink>
            <NavLink
              to="/print"
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              {t('app.nav.print')}
            </NavLink>
              </>
            ) : null}
            {showOrgSwitcher ? (
              <select
                className={styles.devSelect}
                value={me?.organizationId || ''}
                onChange={handleOrgChange}
                aria-label={t('app.nav.switchOrg')}
              >
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            ) : null}
          </nav>
        </div>
      </header>

      <main className={`${styles.main} print-main`}>{children}</main>

      <footer className={`${styles.footer} no-print`}>
        <div className={styles.footerInner}>
          <Link to="/privacy">{t('app.footer.privacy')}</Link>
          {showDevSelector ? (
            <label className={styles.devRole}>
              <span>{t('app.footer.devRole')}</span>
              <select
                className={styles.devSelect}
                value={role}
                onChange={handleRoleChange}
                aria-label={t('app.footer.devRole')}
              >
                <option value="none">{t('app.footer.rolePublic')}</option>
                <option value="keeper">{t('app.footer.roleKeeper')}</option>
                <option value="admin">{t('app.footer.roleAdmin')}</option>
              </select>
            </label>
          ) : me?.user ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span>{me.user.name}</span>
              <a href={withBasePath('/api/auth/logout')} className="btn btn-sm">
                {t('app.footer.logout')}
              </a>
            </div>
          ) : me ? (
            <a href={withBasePath('/api/auth/login')} className="btn btn-sm">
              {t('app.footer.login')}
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
