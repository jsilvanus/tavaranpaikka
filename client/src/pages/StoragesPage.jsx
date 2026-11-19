import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { t, formatDate } from '../i18n/index.js';
import { StorageKindBadge } from '../components/StatusBadge.jsx';
import styles from './StoragesPage.module.css';

const STORAGE_KINDS = ['room', 'first_aid', 'cabinet', 'vehicle', 'other'];

export function attentionScore(storage) {
  const c = storage.counts || {};
  return (
    (c.broken || 0) * 100 +
    (c.expired || 0) * 90 +
    (storage.inspectionDue ? 80 : 0) +
    (c.depleted || 0) * 50 +
    (c.openReports || 0) * 30 +
    (c.expiringSoon || 0) * 20
  );
}

export default function StoragesPage() {
  const [storages, setStorages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('attention');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .getPublicStorages()
      .then((data) => {
        if (active) setStorages(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (active) setError(err.message || t('app.error'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = storages.filter((s) => {
      if (kindFilter && s.kind !== kindFilter) return false;
      if (needle) {
        const hay = `${s.name} ${s.description || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'attention') {
        const diff = attentionScore(b) - attentionScore(a);
        if (diff !== 0) return diff;
      }
      return a.name.localeCompare(b.name, 'fi');
    });
  }, [storages, kindFilter, query, sortBy]);

  return (
    <section>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('storages.title')}</h1>
        <div className={styles.filters}>
          <div className="field">
            <label htmlFor="storages-search">{t('storages.searchLabel')}</label>
            <input
              id="storages-search"
              type="search"
              className="input"
              placeholder={t('storages.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="storages-kind">{t('storages.filterKind')}</label>
            <select
              id="storages-kind"
              className="select"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="">{t('app.all')}</option>
              {STORAGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`storageKind.${k}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="storages-sort">{t('storages.sortLabel')}</label>
            <select
              id="storages-sort"
              className="select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="attention">{t('storages.sortAttention')}</option>
              <option value="name">{t('storages.sortName')}</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading && <p>{t('app.loading')}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p>{t('storages.empty')}</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className={styles.grid}>
          {filtered.map((s) => {
            const c = s.counts || {};
            const needsAttention = attentionScore(s) > 0;
            return (
              <article key={s.id} className="card" data-testid={`storage-card-${s.id}`}>
                <Link to={`/storages/${s.id}`} className={styles.cardLink}>
                  <div className={styles.cardTop}>
                    <h2 className={styles.cardTitle}>{s.name}</h2>
                    <div className={styles.badges}>
                      <StorageKindBadge kind={s.kind} />
                      {s.inspectionDue && (
                        <span className="badge badge-danger">{t('storages.inspectionDue')}</span>
                      )}
                      {needsAttention && !s.inspectionDue && (
                        <span className="badge badge-warn">{t('storages.needsAttention')}</span>
                      )}
                    </div>
                  </div>

                  {s.description && <p className={styles.desc}>{s.description}</p>}

                  <div className={styles.counters}>
                    <span className={styles.counterItem}>
                      {t('storages.counts.places')}: {c.places ?? 0}
                    </span>
                    <span className={styles.counterItem}>
                      {t('storages.counts.items')}: {c.items ?? 0}
                    </span>
                    <span className={styles.counterItem}>
                      {t('storages.counts.entries')}: {c.entries ?? 0}
                    </span>
                  </div>

                  {(c.openReports > 0 ||
                    c.depleted > 0 ||
                    c.broken > 0 ||
                    c.expiringSoon > 0 ||
                    c.expired > 0) && (
                    <div className={styles.alertCounters}>
                      {c.broken > 0 && (
                        <span className="badge badge-danger">
                          {t('storages.counts.broken')}: {c.broken}
                        </span>
                      )}
                      {c.expired > 0 && (
                        <span className="badge badge-danger">
                          {t('storages.counts.expired')}: {c.expired}
                        </span>
                      )}
                      {c.depleted > 0 && (
                        <span className="badge badge-warn">
                          {t('storages.counts.depleted')}: {c.depleted}
                        </span>
                      )}
                      {c.expiringSoon > 0 && (
                        <span className="badge badge-warn">
                          {t('storages.counts.expiringSoon')}: {c.expiringSoon}
                        </span>
                      )}
                      {c.openReports > 0 && (
                        <span className="badge badge-neutral">
                          {t('storages.counts.openReports')}: {c.openReports}
                        </span>
                      )}
                    </div>
                  )}

                  {s.inspectionIntervalDays && (
                    <div className={styles.inspectionLine}>
                      {s.lastInspectedAt
                        ? t('storages.lastInspected', { date: formatDate(s.lastInspectedAt) })
                        : t('storages.neverInspected')}
                    </div>
                  )}
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
