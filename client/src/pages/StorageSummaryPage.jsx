import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { t, formatDate } from '../i18n/index.js';
import { StatusBadge, StorageKindBadge } from '../components/StatusBadge.jsx';
import StorageImagePins from '../components/StorageImagePins.jsx';
import ImageOverlayViewer from '../components/ImageOverlayViewer.jsx';
import LoginRequired from '../components/LoginRequired.jsx';
import { hasRole, useMe } from '../MeContext.jsx';
import styles from './StorageSummaryPage.module.css';

function getExpiryState(expiresOn) {
  if (!expiresOn) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (expiresOn < today) return 'expired';
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 60);
  if (expiresOn <= soonDate.toISOString().slice(0, 10)) return 'soon';
  return 'ok';
}

function buildPlaceTree(places) {
  const map = new Map();
  for (const p of places) {
    map.set(p.id, { ...p, children: [] });
  }
  const roots = [];
  for (const node of map.values()) {
    if (node.parentPlaceId && map.has(node.parentPlaceId)) {
      map.get(node.parentPlaceId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function PlaceBranch({ node }) {
  const hasContents = (node.items?.length || 0) > 0 || (node.entries?.length || 0) > 0;

  return (
    <div className={styles.placeNode} data-testid={`place-branch-${node.id}`}>
      <div className={styles.placeHeader}>
        <h3 className={styles.placeName}>{node.name}</h3>
        {node.path?.length > 1 && (
          <span className={styles.placePath}>{node.path.join(' > ')}</span>
        )}
        {node.pinLabel && <span className="badge badge-neutral">{node.pinLabel}</span>}
      </div>

      {node.description && (
        <p style={{ margin: '0 0 0.4rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {node.description}
        </p>
      )}

      {!hasContents && (!node.children || node.children.length === 0) && (
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          {t('storageSummary.noContents')}
        </p>
      )}

      {hasContents && (
        <ul className={styles.itemList}>
          {(node.items || []).map((item) => {
            const exp = getExpiryState(item.expiresOn);
            return (
              <li key={item.id} className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <strong>{item.name}</strong>
                  {item.description && (
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {item.description}
                    </span>
                  )}
                  <div className={styles.itemMeta}>
                    {item.code && <span>{t('storageSummary.codeLabel', { code: item.code })}</span>}
                    {item.expiresOn && (
                      <span>{t('storageSummary.expiresOn', { date: formatDate(item.expiresOn) })}</span>
                    )}
                    {item.leasedTo && (
                      <span className="badge badge-warn">
                        {t('scan.leasedTo', {
                          name: item.leasedTo,
                          date: formatDate(item.leasedAt),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.itemMeta}>
                  <StatusBadge status={item.status} />
                  {exp === 'expired' && (
                    <span className="badge badge-danger">{t('storageSummary.expiredBadge')}</span>
                  )}
                  {exp === 'soon' && (
                    <span className="badge badge-warn">{t('storageSummary.expiringSoonBadge')}</span>
                  )}
                </div>
              </li>
            );
          })}

          {(node.entries || []).map((entry) => {
            const exp = getExpiryState(entry.expiresOn);
            const qtyText =
              entry.quantity !== null && entry.quantity !== undefined
                ? `${entry.quantity}${entry.quantityNote ? ` (${entry.quantityNote})` : ''}`
                : entry.quantityNote;
            return (
              <li key={entry.id} className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <strong>{entry.name}</strong>
                  <div className={styles.itemMeta}>
                    {qtyText && <span>{t('storageSummary.quantity', { qty: qtyText })}</span>}
                    {entry.minQuantity !== null && entry.minQuantity !== undefined && (
                      <span>{t('storageSummary.minQuantity', { min: entry.minQuantity })}</span>
                    )}
                    {entry.expiresOn && (
                      <span>{t('storageSummary.expiresOn', { date: formatDate(entry.expiresOn) })}</span>
                    )}
                  </div>
                </div>
                <div className={styles.itemMeta}>
                  <StatusBadge status={entry.status} />
                  {exp === 'expired' && (
                    <span className="badge badge-danger">{t('storageSummary.expiredBadge')}</span>
                  )}
                  {exp === 'soon' && (
                    <span className="badge badge-warn">{t('storageSummary.expiringSoonBadge')}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {node.children && node.children.length > 0 && (
        <div className={styles.placeChildren}>
          {node.children.map((child) => (
            <PlaceBranch key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StorageSummaryPage() {
  const { id, code } = useParams();
  const { role } = useMe();
  const isKeeper = hasRole(role, 'keeper');
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inspectMsg, setInspectMsg] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = code ? await api.getPublicStorageByCode(code) : await api.getPublicStorage(id);
      setStorage(data);
    } catch (err) {
      setError(err.status === 401 ? 'login' : err.message || t('app.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id, code]);

  const placeTree = useMemo(() => {
    return buildPlaceTree(storage?.places || []);
  }, [storage]);

  async function handleInspect() {
    setInspectMsg('');
    try {
      await api.inspectStorage(storage.id);
      setInspectMsg(t('storageSummary.inspectedSuccess'));
      await load();
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  if (loading) return <p>{t('app.loading')}</p>;
  if (error === 'login') return <LoginRequired />;
  if (error) return <div className="error-box">{error}</div>;
  if (!storage) return null;

  const showInspection =
    storage.kind === 'kit' ||
    storage.kind === 'first_aid' ||
    Boolean(storage.inspectionIntervalDays);

  return (
    <section>
      <div className={styles.topBar}>
        <Link to={code ? `/c/${encodeURIComponent(code)}` : '/storages'} className="btn btn-sm">
          ← {t('storageSummary.backToList')}
        </Link>
        {isKeeper && (
        <div className={styles.actions}>
          <a
            href={api.getStorageSummaryPdfUrl(storage.id)}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
          >
            {t('storageSummary.printSummaryPdf')}
          </a>
          <Link to={`/print?storageId=${encodeURIComponent(storage.id)}`} className="btn btn-primary btn-sm">
            {t('storageSummary.printLabels')}
          </Link>
        </div>
        )}
      </div>

      <div className={`card ${styles.headerCard}`}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{storage.name}</h1>
          <StorageKindBadge kind={storage.kind} />
          {storage.code && <span className="badge badge-neutral">{storage.code}</span>}
        </div>
        {storage.description && <p style={{ margin: 0 }}>{storage.description}</p>}
        {storage.responsiblePerson?.name && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
            <strong>{t('storageSummary.responsiblePerson', { name: storage.responsiblePerson.name })}</strong>
            {storage.responsiblePerson.email && <div>{t('storageSummary.responsibleEmail', { email: storage.responsiblePerson.email })}</div>}
            {storage.responsiblePerson.phone && <div>{t('storageSummary.responsiblePhone', { phone: storage.responsiblePerson.phone })}</div>}
          </div>
        )}
        {storage.createdBy && (
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t('storageSummary.createdBy', { name: storage.createdBy.name || storage.createdBy.email || storage.createdBy.sub })}
          </p>
        )}

        {showInspection && (
          <div className={styles.inspectionBar}>
            <strong>{t('storageSummary.inspectionTitle')}:</strong>
            {storage.inspectionDue ? (
              <span className="badge badge-danger">{t('storages.inspectionDue')}</span>
            ) : (
              <span className="badge badge-ok">{t('status.ok')}</span>
            )}
            <span>
              {storage.lastInspectedAt
                ? t('storages.lastInspected', { date: formatDate(storage.lastInspectedAt) })
                : t('storages.neverInspected')}
            </span>
            {storage.inspectionIntervalDays && (
              <span>{t('storageSummary.inspectionInterval', { days: storage.inspectionIntervalDays })}</span>
            )}
            {isKeeper && (
              <button type="button" className="btn btn-primary btn-sm" onClick={handleInspect}>
                {t('storageSummary.markInspected')}
              </button>
            )}
          </div>
        )}
        {inspectMsg && <div className="success-box">{inspectMsg}</div>}
      </div>

      {Array.isArray(storage.images) && storage.images.length > 0 ? (
        <div className={`card ${styles.section}`}>
          <h2 className={styles.sectionTitle}>{t('storageSummary.mapTitle')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {storage.images.map((img) => (
              <div key={img.id}>
                <ImageOverlayViewer
                  imageUrl={img.url}
                  alt={img.caption || storage.name}
                  overlays={img.overlays || []}
                />
                {img.caption && (
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {img.caption}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        storage.hasImage &&
        storage.imageUrl && (
          <div className={`card ${styles.section}`}>
            <h2 className={styles.sectionTitle}>{t('storageSummary.mapTitle')}</h2>
            <StorageImagePins
              imageUrl={storage.imageUrl}
              alt={storage.name}
              pins={storage.places || []}
              showZoomControls
            />
          </div>
        )
      )}

      <div className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>{t('storageSummary.openReportsTitle')}</h2>
        {(!storage.openReports || storage.openReports.length === 0) ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            {t('storageSummary.noOpenReports')}
          </p>
        ) : (
          <div className={styles.reportsList}>
            {storage.openReports.map((r) => (
              <span key={r.kind} className="badge badge-warn">
                {t(`reportKind.${r.kind}`)}: {r.count}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>{t('storageSummary.placesTitle')}</h2>
        {placeTree.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('storageSummary.noPlaces')}</p>
        ) : (
          placeTree.map((node) => <PlaceBranch key={node.id} node={node} />)
        )}
      </div>
    </section>
  );
}
