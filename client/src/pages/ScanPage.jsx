import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { t, formatDate } from '../i18n/index.js';
import { StatusBadge, StorageKindBadge } from '../components/StatusBadge.jsx';
import StorageImagePins from '../components/StorageImagePins.jsx';
import styles from './ScanPage.module.css';

const REPORT_KINDS = ['depleted', 'broken', 'expired', 'other'];

export default function ScanPage() {
  const { code } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  // Inline report form state
  const [reportDraft, setReportDraft] = useState(null); // { placeId, itemId, entryId, targetName, kind }
  const [note, setNote] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState('');
  const [openReports, setOpenReports] = useState([]);
  const [votedIds, setVotedIds] = useState(() => new Set());
  const [borrowerName, setBorrowerName] = useState('');
  const [leaseBusy, setLeaseBusy] = useState(false);

  async function handleTakeLease(e) {
    e.preventDefault();
    if (!data?.item || !borrowerName.trim()) return;
    setLeaseBusy(true);
    setError('');
    try {
      const updated = await api.leaseItem(data.item.id, borrowerName.trim());
      setData((prev) => (prev ? { ...prev, item: { ...prev.item, ...updated } } : prev));
      setBorrowerName('');
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setLeaseBusy(false);
    }
  }

  async function handleReturnLease() {
    if (!data?.item) return;
    setLeaseBusy(true);
    setError('');
    try {
      const updated = await api.returnItem(data.item.id);
      setData((prev) => (prev ? { ...prev, item: { ...prev.item, ...updated } } : prev));
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setLeaseBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    setError('');
    setReportDraft(null);
    setSentMessage('');

    api
      .resolveCode(code)
      .then((res) => {
        if (!active) return;
        setData(res);
        setOpenReports(Array.isArray(res.openReports) ? res.openReports : []);
      })
      .catch((err) => {
        if (!active) return;
        if (err.status === 404) {
          setNotFound(true);
        } else {
          setError(err.message || t('app.error'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [code]);

  function openReportForm({ placeId, itemId = null, entryId = null, targetName = '', kind }) {
    setSentMessage('');
    setReportDraft({ placeId, itemId, entryId, targetName, kind });
  }

  async function handleReportSubmit(e) {
    e.preventDefault();
    if (!reportDraft?.placeId) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await api.createPublicReport(reportDraft.placeId, {
        itemId: reportDraft.itemId || undefined,
        entryId: reportDraft.entryId || undefined,
        kind: reportDraft.kind,
        note: note.trim() || undefined,
        name: reporterName.trim() || undefined,
      });
      setSentMessage(t('scan.reportSent'));
      setNote('');
      setReporterName('');
      setReportDraft(null);
      if (created && created.id) {
        setOpenReports((prev) => {
          const exists = prev.some((r) => r.id === created.id);
          if (exists) {
            return prev.map((r) => (r.id === created.id ? { ...r, ...created } : r));
          }
          return [created, ...prev];
        });
      }
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(reportId) {
    try {
      const res = await api.votePublicReport(reportId);
      setOpenReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, votes: res.votes ?? (r.votes || 1) + 1 } : r))
      );
      setVotedIds((prev) => {
        const next = new Set(prev);
        next.add(reportId);
        return next;
      });
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  if (loading) return <p>{t('app.loading')}</p>;

  if (notFound) {
    return (
      <div className="card">
        <h1 className={styles.title}>{t('scan.unknownTitle')}</h1>
        <p>{t('scan.unknownBody')}</p>
        <Link to="/storages" className="btn">
          {t('storages.title')}
        </Link>
      </div>
    );
  }

  if (error && !data) return <div className="error-box">{error}</div>;
  if (!data) return null;

  const { kind, storage, place, item, placeDetail } = data;
  const fullPath = place?.path?.length
    ? [storage.name, ...place.path].join(' > ')
    : storage.name;

  const pins =
    kind === 'storage'
      ? storage.places || []
      : place
        ? [place]
        : [];

  return (
    <section className={styles.stack}>
      <div className="card">
        <div className={styles.headerRow}>
          <span className="badge badge-neutral">{t(`codeKind.${kind}`)}</span>
          <StorageKindBadge kind={storage.kind} />
        </div>

        {kind === 'item' && item && (
          <>
            <h1 className={styles.title}>{item.name}</h1>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
              <StatusBadge status={item.status} />
              {item.code && <span className="badge badge-neutral">{item.code}</span>}
              {item.expiresOn && (
                <span className="badge badge-warn">
                  {t('storageSummary.expiresOn', { date: formatDate(item.expiresOn) })}
                </span>
              )}
            </div>
            {item.description && <p>{item.description}</p>}
          </>
        )}

        {kind === 'place' && place && (
          <>
            <h1 className={styles.title}>{place.name}</h1>
            {place.description && <p>{place.description}</p>}
          </>
        )}

        {kind === 'storage' && (
          <>
            <h1 className={styles.title}>{storage.name}</h1>
            {storage.description && <p>{storage.description}</p>}
            <Link to={`/storages/${storage.id}`} className="btn btn-sm">
              {t('storageSummary.placesTitle')}
            </Link>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>{t('scan.locationTitle')}</h2>
        {kind === 'item' && !place ? (
          <p>{t('scan.unplaced')}</p>
        ) : (
          <>
            <p className={styles.pathText}>{t('scan.pinPath', { path: fullPath })}</p>
            {place?.pinLabel && (
              <p style={{ margin: '0 0 0.5rem 0' }}>
                {t('scan.pinLabel', { label: place.pinLabel })}
              </p>
            )}
          </>
        )}

        {storage.hasImage && storage.imageUrl ? (
          <StorageImagePins
            imageUrl={storage.imageUrl}
            alt={storage.name}
            pins={pins}
            pulsingPinId={place?.id || null}
          />
        ) : (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('scan.noImage')}</p>
        )}
      </div>

      {kind === 'item' && item && item.leaseable && (
        <div className="card">
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>{t('scan.leaseTitle')}</h2>
          {item.leasedTo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span className="badge badge-warn">
                {t('scan.leasedTo', {
                  name: item.leasedTo,
                  date: item.leasedAt ? new Date(item.leasedAt).toLocaleString('fi-FI') : '',
                })}
              </span>
              <div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={leaseBusy}
                  onClick={handleReturnLease}
                >
                  {t('scan.returnLease')}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleTakeLease} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="lease-borrower">{t('scan.borrowerLabel')}</label>
              <input
                id="lease-borrower"
                type="text"
                className="input"
                required
                placeholder={t('scan.borrowerPlaceholder')}
                value={borrowerName}
                onChange={(e) => setBorrowerName(e.target.value)}
              />
              <div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={leaseBusy || !borrowerName.trim()}
                >
                  {t('scan.confirmLease')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {kind === 'item' && item && place && (
        <div className="card">
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>{t('scan.reportTitle')}</h2>
          <div className={styles.quickButtons}>
            {REPORT_KINDS.map((rk) => (
              <button
                key={rk}
                type="button"
                className={`btn btn-sm ${rk === 'broken' ? 'btn-danger' : rk === 'depleted' ? 'btn-warn' : ''}`}
                onClick={() =>
                  openReportForm({
                    placeId: place.id,
                    itemId: item.id,
                    targetName: item.name,
                    kind: rk,
                  })
                }
              >
                {t(`reportKind.${rk}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {kind === 'place' && placeDetail && (
        <div className="card">
          <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
            {t('scan.placeContentsTitle')}
          </h2>
          <ul className={styles.contentsList}>
            {(placeDetail.items || []).map((it) => (
              <li key={it.id} className={styles.contentRow}>
                <div className={styles.contentTop}>
                  <strong>{it.name}</strong>
                  <StatusBadge status={it.status} />
                </div>
                <div className={styles.quickButtons}>
                  {REPORT_KINDS.map((rk) => (
                    <button
                      key={rk}
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        openReportForm({
                          placeId: place.id,
                          itemId: it.id,
                          targetName: it.name,
                          kind: rk,
                        })
                      }
                    >
                      {t(`reportKind.${rk}`)}
                    </button>
                  ))}
                </div>
              </li>
            ))}

            {(placeDetail.entries || []).map((en) => (
              <li key={en.id} className={styles.contentRow}>
                <div className={styles.contentTop}>
                  <div>
                    <strong>{en.name}</strong>
                    {en.quantityNote && (
                      <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>
                        ({en.quantityNote})
                      </span>
                    )}
                  </div>
                  <StatusBadge status={en.status} />
                </div>
                <div className={styles.quickButtons}>
                  {REPORT_KINDS.map((rk) => (
                    <button
                      key={rk}
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        openReportForm({
                          placeId: place.id,
                          entryId: en.id,
                          targetName: en.name,
                          kind: rk,
                        })
                      }
                    >
                      {t(`reportKind.${rk}`)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                openReportForm({
                  placeId: place.id,
                  targetName: place.name,
                  kind: 'other',
                })
              }
            >
              {t('reportKind.other')}
            </button>
          </div>
        </div>
      )}

      {kind === 'storage' && storage.places && (
        <div className="card">
          <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
            {t('scan.storageContentsTitle')}
          </h2>
          <ul className={styles.contentsList}>
            {storage.places.map((pl) => (
              <li key={pl.id} className={styles.contentRow}>
                <div className={styles.contentTop}>
                  <strong>{pl.path?.join(' > ') || pl.name}</strong>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      openReportForm({
                        placeId: pl.id,
                        targetName: pl.name,
                        kind: 'other',
                      })
                    }
                  >
                    {t('reportKind.other')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}
      {sentMessage && <div className="success-box">{sentMessage}</div>}

      {reportDraft && (
        <form className={styles.reportForm} onSubmit={handleReportSubmit} data-testid="report-form">
          <h2 style={{ margin: '0 0 0.35rem 0', fontSize: '1.15rem' }}>
            {t(`reportKind.${reportDraft.kind}`)}: {reportDraft.targetName}
          </h2>
          <p className={styles.hint}>{t('scan.reportHint')}</p>

          <div className="field">
            <label htmlFor="report-note">{t('scan.reportNoteLabel')}</label>
            <textarea
              id="report-note"
              className="textarea"
              maxLength={500}
              placeholder={t('scan.reportNotePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="report-name">{t('scan.reportNameLabel')}</label>
            <input
              id="report-name"
              type="text"
              className="input"
              maxLength={100}
              placeholder={t('scan.reportNamePlaceholder')}
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
            />
          </div>

          <div className={styles.quickButtons}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? t('scan.submitting') : t('scan.submitReport')}
            </button>
            <button type="button" className="btn" onClick={() => setReportDraft(null)}>
              {t('app.cancel')}
            </button>
          </div>
        </form>
      )}

      {openReports.length > 0 && (
        <div className="card">
          <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
            {t('scan.existingReportsTitle')}
          </h2>
          <div className={styles.stack}>
            {openReports.map((rep) => (
              <div key={rep.id} className={styles.reportCard} data-testid={`open-report-${rep.id}`}>
                <div>
                  <strong>{t(`reportKind.${rep.kind}`)}</strong>
                  {rep.targetName && <span> — {rep.targetName}</span>}
                  {rep.note && <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.9rem' }}>{rep.note}</p>}
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {t('scan.votesCount', { count: rep.votes || 1 })}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={votedIds.has(rep.id)}
                  onClick={() => handleVote(rep.id)}
                >
                  {votedIds.has(rep.id) ? t('scan.votedThanks') : t('scan.meToo')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
