import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { t } from '../i18n/index.js';
import { getDevRole, setDevRole } from '../api/client.js';
import styles from './Layout.module.css';

export default function Layout({ children }) {
  const [role, setRole] = useState(() => getDevRole());

  function handleRoleChange(e) {
    const next = e.target.value;
    setRole(next);
    setDevRole(next);
  }

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
          </nav>
        </div>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={`${styles.footer} no-print`}>
        <div className={styles.footerInner}>
          <Link to="/privacy">{t('app.footer.privacy')}</Link>
          <label className={styles.devRole}>
            <span>{t('app.footer.devRole')}</span>
            <select
              className={styles.devSelect}
              value={role}
              onChange={handleRoleChange}
              aria-label={t('app.footer.devRole')}
            >
              <option value="">{t('app.footer.rolePublic')}</option>
              <option value="keeper">{t('app.footer.roleKeeper')}</option>
              <option value="admin">{t('app.footer.roleAdmin')}</option>
            </select>
          </label>
        </div>
      </footer>
    </div>
  );
}
