import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { t, formatDateTime } from '../i18n/index.js';
import { ReportStatusBadge, StatusBadge, StorageKindBadge } from '../components/StatusBadge.jsx';
import StorageImagePins from '../components/StorageImagePins.jsx';
import ImageOverlayViewer from '../components/ImageOverlayViewer.jsx';
import styles from './ManagePage.module.css';

const STORAGE_KINDS = ['room', 'kit', 'cabinet', 'vehicle', 'other'];
const ITEM_STATUSES = ['ok', 'depleted', 'broken', 'retired'];
const ENTRY_STATUSES = ['ok', 'depleted', 'retired'];
const REPORT_KINDS = ['depleted', 'broken', 'expired', 'other'];
const REPORT_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'];

export default function ManagePage() {
  const [tab, setTab] = useState('inbox');
  const [inbox, setInbox] = useState({ unreadCount: 0, items: [] });
  const [storages, setStorages] = useState([]);
  const [selectedStorageId, setSelectedStorageId] = useState('');
  const [storageDetail, setStorageDetail] = useState(null);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Storage form
  const [editingStorageId, setEditingStorageId] = useState(null);
  const [stForm, setStForm] = useState({
    name: '',
    kind: 'room',
    description: '',
    inspectionIntervalDays: '',
    notifyBeforeDays: '',
    publicListed: true,
  });
  const [imageFile, setImageFile] = useState(null);
  const [noPeopleChecked, setNoPeopleChecked] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [orgLogoUrl, setOrgLogoUrl] = useState(null);
  const [orgLogoFile, setOrgLogoFile] = useState(null);
  const [storageLogoFile, setStorageLogoFile] = useState(null);

  // Place form
  const [editingPlaceId, setEditingPlaceId] = useState(null);
  const [plForm, setPlForm] = useState({
    name: '',
    parentPlaceId: '',
    description: '',
    pinLabel: '',
    pinX: null,
    pinY: null,
  });

  // Item / Entry forms
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    category: '',
    status: 'ok',
    expiresOn: '',
    minQuantity: '',
    leaseable: false,
  });
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [entryForm, setEntryForm] = useState({
    name: '',
    quantity: '',
    quantityNote: '',
    minQuantity: '',
    expiresOn: '',
    status: 'ok',
  });

  // Report inbox filters
  const [repFilter, setRepFilter] = useState({ status: 'open', storageId: '', kind: '' });

  // Admin-only lease audit
  const [leases, setLeases] = useState([]);
  const [leasesForbidden, setLeasesForbidden] = useState(false);

  // Admin-only per-tenant privacy & processor settings
  const [privacyForm, setPrivacyForm] = useState({
    controllerName: '',
    controllerContact: '',
    leaseRetentionDays: 365,
    processors: [],
    privacyExtra: '',
  });

  // Multi-image & overlay drawing state
  const [extraImageFile, setExtraImageFile] = useState(null);
  const [extraImageCaption, setExtraImageCaption] = useState('');
  const [itemImageFile, setItemImageFile] = useState(null);
  const [selectedOverlayImageId, setSelectedOverlayImageId] = useState('');
  const [overlayLabel, setOverlayLabel] = useState('');

  async function loadStorages() {
    try {
      const list = await api.getStorages();
      setStorages(list);
      if (!selectedStorageId && list.length > 0) {
        setSelectedStorageId(list[0].id);
      }
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  async function loadStorageDetail(id) {
    if (!id) {
      setStorageDetail(null);
      return;
    }
    try {
      const detail = await api.getStorage(id);
      setStorageDetail(detail);
      if (detail.places?.length > 0) {
        setSelectedPlaceId((prev) =>
          detail.places.some((p) => p.id === prev) ? prev : detail.places[0].id
        );
      } else {
        setSelectedPlaceId('');
      }
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  async function loadReports() {
    try {
      const list = await api.getReports(repFilter);
      setReports(list);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  async function loadInbox() {
    try {
      const data = await api.getNotifications();
      setInbox(data || { unreadCount: 0, items: [] });
    } catch {
      // Ignore if unauthorized
    }
  }

  useEffect(() => {
    loadStorages();
    loadInbox();
    api
      .getOrganizationLogo()
      .then((res) => setOrgLogoUrl(res?.logoUrl || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedStorageId) {
      loadStorageDetail(selectedStorageId);
    }
  }, [selectedStorageId]);

  useEffect(() => {
    if (tab === 'reports') {
      loadReports();
    } else if (tab === 'inbox') {
      loadInbox();
    }
  }, [tab, repFilter]);

  const activePlace = useMemo(() => {
    return storageDetail?.places?.find((p) => p.id === selectedPlaceId) || null;
  }, [storageDetail, selectedPlaceId]);

  // Storage handlers
  async function handleSaveStorage(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    const payload = {
      name: stForm.name.trim(),
      kind: stForm.kind,
      description: stForm.description.trim(),
      inspectionIntervalDays: stForm.inspectionIntervalDays
        ? Number(stForm.inspectionIntervalDays)
        : null,
      notifyBeforeDays: stForm.notifyBeforeDays ? Number(stForm.notifyBeforeDays) : null,
      publicListed: stForm.publicListed,
    };
    try {
      if (editingStorageId) {
        await api.updateStorage(editingStorageId, payload);
      } else {
        const created = await api.createStorage(payload);
        setSelectedStorageId(created.id);
      }
      setEditingStorageId(null);
      setStForm({
        name: '',
        kind: 'room',
        description: '',
        inspectionIntervalDays: '',
        notifyBeforeDays: '',
        publicListed: true,
      });
      await loadStorages();
      if (selectedStorageId) await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  function startEditStorage(s) {
    setEditingStorageId(s.id);
    setSelectedStorageId(s.id);
    setStForm({
      name: s.name,
      kind: s.kind === 'first_aid' ? 'kit' : s.kind,
      description: s.description || '',
      inspectionIntervalDays: s.inspectionIntervalDays ?? '',
      notifyBeforeDays: s.notifyBeforeDays ?? '',
      publicListed: s.publicListed !== false,
    });
  }

  async function handleUploadImage(e) {
    e.preventDefault();
    if (!selectedStorageId || !imageFile || !noPeopleChecked) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      await api.uploadStorageImage(selectedStorageId, imageFile);
      setMessage(t('manage.storages.imageUploaded'));
      setImageFile(null);
      setNoPeopleChecked(false);
      await loadStorages();
      await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadStorageLogo(e) {
    e.preventDefault();
    if (!selectedStorageId || !storageLogoFile) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      await api.uploadStorageLogo(selectedStorageId, storageLogoFile);
      setMessage(t('manage.storages.logoUpdated'));
      setStorageLogoFile(null);
      await loadStorages();
      await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleResetStorageLogo() {
    if (!selectedStorageId) return;
    setError('');
    setMessage('');
    try {
      await api.deleteStorageLogo(selectedStorageId);
      setMessage(t('manage.storages.logoUpdated'));
      await loadStorages();
      await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  async function handleUploadOrgLogo(e) {
    e.preventDefault();
    if (!orgLogoFile) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const res = await api.uploadOrganizationLogo(orgLogoFile);
      setOrgLogoUrl(res.logoUrl || null);
      setOrgLogoFile(null);
      setMessage(t('manage.storages.logoUpdated'));
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleResetOrgLogo() {
    setError('');
    setMessage('');
    try {
      await api.deleteOrganizationLogo();
      setOrgLogoUrl(null);
      setMessage(t('manage.storages.logoUpdated'));
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  async function handleUploadExtraStorageImage(e) {
    e.preventDefault();
    if (!selectedStorageId || !extraImageFile) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadStorageExtraImage(selectedStorageId, extraImageFile, extraImageCaption.trim());
      setExtraImageFile(null);
      setExtraImageCaption('');
      await loadStorageDetail(selectedStorageId);
      await loadStorages();
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadItemImage(e) {
    e.preventDefault();
    if (!editingItemId || !itemImageFile) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadItemImage(editingItemId, itemImageFile);
      setItemImageFile(null);
      await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDrawOverlay(imageId, targetKind, targetId, coords, fallbackLabel) {
    setError('');
    try {
      await api.addImageOverlay(imageId, {
        targetKind,
        targetId: targetKind === 'general' ? null : targetId,
        shape: 'rect',
        coords,
        label: overlayLabel.trim() || fallbackLabel || '',
      });
      setOverlayLabel('');
      await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  async function handleIssueCode(kind, targetId) {
    setError('');
    try {
      await api.issueCode(kind, targetId);
      await loadStorages();
      if (selectedStorageId) await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  async function handleVoidCode(code) {
    setError('');
    try {
      await api.voidCode(code);
      await loadStorages();
      if (selectedStorageId) await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  // Place handlers
  async function handleSavePlace(e) {
    e.preventDefault();
    if (!selectedStorageId) return;
    setError('');
    const payload = {
      storageId: selectedStorageId,
      name: plForm.name.trim(),
      parentPlaceId: plForm.parentPlaceId || null,
      description: plForm.description.trim(),
      pinLabel: plForm.pinLabel.trim(),
      pinX: plForm.pinX,
      pinY: plForm.pinY,
    };
    try {
      if (editingPlaceId) {
        await api.updatePlace(editingPlaceId, payload);
      } else {
        await api.createPlace(payload);
      }
      setEditingPlaceId(null);
      setPlForm({ name: '', parentPlaceId: '', description: '', pinLabel: '', pinX: null, pinY: null });
      await loadStorageDetail(selectedStorageId);
      await loadStorages();
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  function startEditPlace(pl) {
    setEditingPlaceId(pl.id);
    setPlForm({
      name: pl.name,
      parentPlaceId: pl.parentPlaceId || '',
      description: pl.description || '',
      pinLabel: pl.pinLabel || '',
      pinX: pl.pinX,
      pinY: pl.pinY,
    });
  }

  // Item handlers
  async function handleSaveItem(e) {
    e.preventDefault();
    if (!selectedPlaceId) return;
    setError('');
    const payload = {
      placeId: selectedPlaceId,
      name: itemForm.name.trim(),
      description: itemForm.description.trim(),
      category: itemForm.category.trim(),
      status: itemForm.status,
      expiresOn: itemForm.expiresOn || null,
      minQuantity: itemForm.minQuantity ? Number(itemForm.minQuantity) : null,
      leaseable: Boolean(itemForm.leaseable),
    };
    try {
      if (editingItemId) {
        await api.updateItem(editingItemId, payload);
      } else {
        await api.createItem(payload);
      }
      setEditingItemId(null);
      setItemForm({
        name: '',
        description: '',
        category: '',
        status: 'ok',
        expiresOn: '',
        minQuantity: '',
        leaseable: false,
      });
      await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  useEffect(() => {
    if (tab !== 'leases') return;
    setLeasesForbidden(false);
    api
      .getAdminLeases()
      .then((list) => setLeases(Array.isArray(list) ? list : []))
      .catch((err) => {
        if (err.status === 403 || err.status === 401) {
          setLeasesForbidden(true);
        } else {
          setError(err.message || t('app.error'));
        }
      });
  }, [tab]);

  useEffect(() => {
    if (tab !== 'privacy') return;
    api
      .getPublicPrivacy()
      .then((info) => {
        setPrivacyForm({
          controllerName: info.controllerName || '',
          controllerContact: info.controllerContact || '',
          leaseRetentionDays: info.leaseRetentionDays ?? 365,
          processors: Array.isArray(info.processors) ? info.processors : [],
          privacyExtra: info.privacyExtra || '',
        });
      })
      .catch(() => {});
  }, [tab]);

  async function handleSavePrivacy(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const updated = await api.updateAdminPrivacy({
        controllerName: privacyForm.controllerName.trim(),
        controllerContact: privacyForm.controllerContact.trim(),
        leaseRetentionDays: Number(privacyForm.leaseRetentionDays) || 365,
        processors: privacyForm.processors.filter((p) => p.name.trim()),
        privacyExtra: privacyForm.privacyExtra,
      });
      setPrivacyForm({
        controllerName: updated.controllerName || '',
        controllerContact: updated.controllerContact || '',
        leaseRetentionDays: updated.leaseRetentionDays ?? 365,
        processors: Array.isArray(updated.processors) ? updated.processors : [],
        privacyExtra: updated.privacyExtra || '',
      });
      setMessage(t('manage.privacy.saved'));
    } catch (err) {
      if (err.status === 403 || err.status === 401) {
        setError(t('manage.privacy.adminOnly'));
      } else {
        setError(err.message || t('app.error'));
      }
    }
  }

  // Entry handlers
  async function handleSaveEntry(e) {
    e.preventDefault();
    if (!selectedPlaceId) return;
    setError('');
    const payload = {
      name: entryForm.name.trim(),
      quantity: entryForm.quantity !== '' ? Number(entryForm.quantity) : null,
      quantityNote: entryForm.quantityNote.trim(),
      minQuantity: entryForm.minQuantity !== '' ? Number(entryForm.minQuantity) : null,
      expiresOn: entryForm.expiresOn || null,
      status: entryForm.status,
    };
    try {
      if (editingEntryId) {
        await api.updateEntry(selectedPlaceId, editingEntryId, payload);
      } else {
        await api.createEntry(selectedPlaceId, payload);
      }
      setEditingEntryId(null);
      setEntryForm({ name: '', quantity: '', quantityNote: '', minQuantity: '', expiresOn: '', status: 'ok' });
      await loadStorageDetail(selectedStorageId);
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  // Report inbox handlers
  async function handleReportAction(id, action) {
    setError('');
    try {
      if (action === 'ack') await api.ackReport(id);
      if (action === 'resolve') await api.resolveReport(id);
      if (action === 'dismiss') await api.dismissReport(id);
      await loadReports();
    } catch (err) {
      setError(err.message || t('app.error'));
    }
  }

  const previewPins = useMemo(() => {
    const existing = storageDetail?.places || [];
    if (plForm.pinX === null || plForm.pinY === null) return existing;
    if (editingPlaceId) {
      return existing.map((p) =>
        p.id === editingPlaceId ? { ...p, pinX: plForm.pinX, pinY: plForm.pinY } : p
      );
    }
    return [
      ...existing,
      { id: 'draft-pin', name: plForm.name || t('manage.places.newTitle'), pinX: plForm.pinX, pinY: plForm.pinY },
    ];
  }, [storageDetail, plForm, editingPlaceId]);

  return (
    <section>
      <h1 style={{ margin: '0 0 0.75rem 0', fontSize: '1.5rem' }}>{t('manage.title')}</h1>

      <div className={styles.tabs} role="tablist">
        {['inbox', 'storages', 'places', 'items', 'reports', 'leases', 'privacy'].map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`${styles.tabBtn} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => setTab(key)}
          >
            {t(`manage.tabs.${key}`)}
            {key === 'inbox' && inbox.unreadCount > 0 ? ` (${inbox.unreadCount})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      {tab === 'inbox' && (
        <div className={styles.list}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
              {t('manage.inbox.title')}{' '}
              {inbox.unreadCount > 0 && (
                <span className="badge badge-warn">
                  {t('manage.inbox.unreadBadge', { count: inbox.unreadCount })}
                </span>
              )}
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    const res = await api.checkExpiryNotifications();
                    await loadInbox();
                    setMessage(`Tarkistettu (${res.created} uutta ilmoitusta)`);
                  } catch (err) {
                    setError(err.message || t('app.error'));
                  }
                }}
              >
                {t('manage.inbox.checkExpiries')}
              </button>
              {inbox.unreadCount > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    try {
                      await api.markAllNotificationsRead();
                      await loadInbox();
                    } catch (err) {
                      setError(err.message || t('app.error'));
                    }
                  }}
                >
                  {t('manage.inbox.markAllRead')}
                </button>
              )}
            </div>
          </div>

          {inbox.items.length === 0 ? (
            <div className="card">{t('manage.inbox.empty')}</div>
          ) : (
            inbox.items.map((n) => (
              <div
                key={n.id}
                className={styles.rowCard}
                style={{ opacity: n.readAt ? 0.72 : 1 }}
              >
                <div className={styles.rowTop}>
                  <strong>{n.title}</strong>
                  {!n.readAt && <span className="badge badge-warn">Uusi</span>}
                </div>
                {n.body && <p style={{ margin: 0, fontSize: '0.9rem' }}>{n.body}</p>}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {formatDateTime(n.createdAt)}
                  </span>
                  {!n.readAt && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        try {
                          await api.markNotificationRead(n.id);
                          await loadInbox();
                        } catch (err) {
                          setError(err.message || t('app.error'));
                        }
                      }}
                    >
                      {t('manage.inbox.markRead')}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'storages' && (
        <div className={styles.split}>
          <div className={styles.list}>
            {storages.map((s) => (
              <div key={s.id} className={styles.rowCard}>
                <div className={styles.rowTop}>
                  <strong>{s.name}</strong>
                  <StorageKindBadge kind={s.kind} />
                </div>
                {s.description && <p style={{ margin: 0, fontSize: '0.9rem' }}>{s.description}</p>}
                <div className={styles.rowActions}>
                  <button type="button" className="btn btn-sm" onClick={() => startEditStorage(s)}>
                    {t('app.edit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleIssueCode('storage', s.id)}
                  >
                    {t('manage.storages.issueCode')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      await api.deleteStorage(s.id);
                      await loadStorages();
                    }}
                  >
                    {t('app.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.list}>
            <form className="card" onSubmit={handleSaveStorage}>
              <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
                {editingStorageId ? t('manage.storages.editTitle') : t('manage.storages.newTitle')}
              </h2>
              <div className="field">
                <label htmlFor="st-name">{t('manage.storages.name')}</label>
                <input
                  id="st-name"
                  className="input"
                  required
                  value={stForm.name}
                  onChange={(e) => setStForm({ ...stForm, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="st-kind">{t('manage.storages.kind')}</label>
                <select
                  id="st-kind"
                  className="select"
                  value={stForm.kind}
                  onChange={(e) => setStForm({ ...stForm, kind: e.target.value })}
                >
                  {STORAGE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`storageKind.${k}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="st-desc">{t('manage.storages.description')}</label>
                <textarea
                  id="st-desc"
                  className="textarea"
                  value={stForm.description}
                  onChange={(e) => setStForm({ ...stForm, description: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="st-interval">{t('manage.storages.inspectionIntervalDays')}</label>
                <input
                  id="st-interval"
                  type="number"
                  min="1"
                  className="input"
                  value={stForm.inspectionIntervalDays}
                  onChange={(e) => setStForm({ ...stForm, inspectionIntervalDays: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="st-notify-before">{t('manage.storages.notifyBeforeDays')}</label>
                <input
                  id="st-notify-before"
                  type="number"
                  min="1"
                  max="365"
                  className="input"
                  value={stForm.notifyBeforeDays}
                  onChange={(e) => setStForm({ ...stForm, notifyBeforeDays: e.target.value })}
                />
              </div>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={stForm.publicListed}
                  onChange={(e) => setStForm({ ...stForm, publicListed: e.target.checked })}
                />
                <span>{t('manage.storages.publicListed')}</span>
              </label>

              <div className={styles.formActions}>
                <button type="submit" className="btn btn-primary">
                  {t('app.save')}
                </button>
                {editingStorageId && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditingStorageId(null);
                      setStForm({
                        name: '',
                        kind: 'room',
                        description: '',
                        inspectionIntervalDays: '',
                        publicListed: true,
                      });
                    }}
                  >
                    {t('app.cancel')}
                  </button>
                )}
              </div>
            </form>

            {selectedStorageId && (
              <form className="card" onSubmit={handleUploadImage}>
                <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>
                  {t('manage.storages.imageSection')}
                </h2>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  {t('manage.storages.imageGuide')}
                </p>
                <div className="field">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                  />
                </div>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={noPeopleChecked}
                    onChange={(e) => setNoPeopleChecked(e.target.checked)}
                  />
                  <span>{t('manage.storages.noPeopleCheck')}</span>
                </label>
                <div className={styles.formActions}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!imageFile || !noPeopleChecked || uploading}
                  >
                    {uploading ? t('manage.storages.uploading') : t('manage.storages.uploadImage')}
                  </button>
                </div>
              </form>
            )}

            {selectedStorageId && (
              <form
                onSubmit={handleUploadExtraStorageImage}
                className="card"
                style={{ marginTop: '1rem' }}
              >
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem' }}>
                  {t('manage.storages.galleryTitle', { count: storageDetail?.images?.length || 0 })}
                </h3>
                {Array.isArray(storageDetail?.images) && storageDetail.images.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    {storageDetail.images.map((img) => (
                      <div key={img.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <img
                          src={img.url}
                          alt={img.caption || storageDetail.name}
                          style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={async () => {
                            setError('');
                            try {
                              await api.deleteImage(img.id);
                              await loadStorageDetail(selectedStorageId);
                            } catch (err) {
                              setError(err.message || t('app.error'));
                            }
                          }}
                        >
                          {t('app.delete')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="field">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setExtraImageFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div className="field">
                  <input
                    type="text"
                    className="input"
                    placeholder={t('manage.storages.captionPlaceholder')}
                    value={extraImageCaption}
                    onChange={(e) => setExtraImageCaption(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!extraImageFile || uploading}
                >
                  {t('manage.storages.addGalleryImage')}
                </button>
              </form>
            )}

            {selectedStorageId && (
              <form
                onSubmit={handleUploadStorageLogo}
                className="card"
                style={{ marginTop: '1rem' }}
              >
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem' }}>
                  {t('manage.storages.storageLogoTitle')}
                </h3>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {t('manage.storages.storageLogoHint')}
                </p>
                {storageDetail?.logoUrl && (
                  <img
                    src={storageDetail.logoUrl}
                    alt={t('manage.storages.storageLogoAlt')}
                    style={{ width: 56, height: 56, objectFit: 'contain', marginBottom: '0.5rem' }}
                  />
                )}
                <div className="field">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => setStorageLogoFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div className={styles.formActions}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!storageLogoFile || uploading}
                  >
                    {t('manage.storages.uploadLogo')}
                  </button>
                  {storageDetail?.hasLogo && (
                    <button type="button" className="btn" onClick={handleResetStorageLogo}>
                      {t('manage.storages.resetLogo')}
                    </button>
                  )}
                </div>
              </form>
            )}

            <form
              onSubmit={handleUploadOrgLogo}
              className="card"
              style={{ marginTop: '1rem' }}
            >
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem' }}>
                {t('manage.storages.orgLogoTitle')}
              </h3>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {t('manage.storages.orgLogoHint')}
              </p>
              {orgLogoUrl && (
                <img
                  src={orgLogoUrl}
                  alt={t('manage.storages.orgLogoAlt')}
                  style={{ width: 56, height: 56, objectFit: 'contain', marginBottom: '0.5rem' }}
                />
              )}
              <div className="field">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => setOrgLogoFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className={styles.formActions}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!orgLogoFile || uploading}
                >
                  {t('manage.storages.uploadLogo')}
                </button>
                {orgLogoUrl && (
                  <button type="button" className="btn" onClick={handleResetOrgLogo}>
                    {t('manage.storages.resetLogo')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'places' && (
        <div className={styles.list}>
          <div className="card">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pl-storage-select">{t('manage.places.selectStorage')}</label>
              <select
                id="pl-storage-select"
                className="select"
                value={selectedStorageId}
                onChange={(e) => setSelectedStorageId(e.target.value)}
              >
                {storages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.split}>
            <div className={styles.list}>
              {(storageDetail?.places || []).map((pl) => (
                <div key={pl.id} className={styles.rowCard}>
                  <div className={styles.rowTop}>
                    <strong>{pl.path?.join(' > ') || pl.name}</strong>
                    {pl.code && <span className="badge badge-neutral">{pl.code}</span>}
                  </div>
                  {pl.pinLabel && <span style={{ fontSize: '0.85rem' }}>{pl.pinLabel}</span>}
                  <div className={styles.rowActions}>
                    <button type="button" className="btn btn-sm" onClick={() => startEditPlace(pl)}>
                      {t('app.edit')}
                    </button>
                    {!pl.code ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleIssueCode('place', pl.id)}
                      >
                        {t('manage.items.issueCode')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-warn"
                        onClick={() => handleVoidCode(pl.code)}
                      >
                        {t('manage.items.voidCode')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await api.deletePlace(pl.id);
                        await loadStorageDetail(selectedStorageId);
                      }}
                    >
                      {t('app.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form className="card" onSubmit={handleSavePlace}>
              <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
                {editingPlaceId ? t('manage.places.editTitle') : t('manage.places.newTitle')}
              </h2>
              <div className="field">
                <label htmlFor="pl-name">{t('manage.places.name')}</label>
                <input
                  id="pl-name"
                  className="input"
                  required
                  value={plForm.name}
                  onChange={(e) => setPlForm({ ...plForm, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="pl-parent">{t('manage.places.parentPlace')}</label>
                <select
                  id="pl-parent"
                  className="select"
                  value={plForm.parentPlaceId}
                  onChange={(e) => setPlForm({ ...plForm, parentPlaceId: e.target.value })}
                >
                  <option value="">{t('manage.places.noParent')}</option>
                  {(storageDetail?.places || [])
                    .filter((p) => p.id !== editingPlaceId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.path?.join(' > ') || p.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pl-pin-label">{t('manage.places.pinLabel')}</label>
                <input
                  id="pl-pin-label"
                  className="input"
                  value={plForm.pinLabel}
                  onChange={(e) => setPlForm({ ...plForm, pinLabel: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="pl-desc">{t('manage.places.description')}</label>
                <textarea
                  id="pl-desc"
                  className="textarea"
                  value={plForm.description}
                  onChange={(e) => setPlForm({ ...plForm, description: e.target.value })}
                />
              </div>

              {storageDetail?.hasImage && storageDetail?.imageUrl && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong>{t('manage.places.pinSection')}</strong>
                  <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {t('manage.places.pinHint')}
                  </p>
                  <StorageImagePins
                    imageUrl={storageDetail.imageUrl}
                    alt={storageDetail.name}
                    pins={previewPins}
                    activePinId={editingPlaceId || 'draft-pin'}
                    interactive
                    showZoomControls
                    onSelectCoords={(x, y) => setPlForm({ ...plForm, pinX: x, pinY: y })}
                  />
                  <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem' }}>
                      {plForm.pinX !== null
                        ? t('manage.places.pinCoords', {
                            x: Math.round(plForm.pinX * 100),
                            y: Math.round(plForm.pinY * 100),
                          })
                        : t('manage.places.noPin')}
                    </span>
                    {plForm.pinX !== null && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setPlForm({ ...plForm, pinX: null, pinY: null })}
                      >
                        {t('manage.places.clearPin')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.formActions}>
                <button type="submit" className="btn btn-primary">
                  {t('app.save')}
                </button>
                {editingPlaceId && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditingPlaceId(null);
                      setPlForm({
                        name: '',
                        parentPlaceId: '',
                        description: '',
                        pinLabel: '',
                        pinX: null,
                        pinY: null,
                      });
                    }}
                  >
                    {t('app.cancel')}
                  </button>
                )}
              </div>
            </form>
          </div>

          {Array.isArray(storageDetail?.images) && storageDetail.images.length > 0 && (() => {
            const activeImg =
              storageDetail.images.find((im) => im.id === selectedOverlayImageId) ||
              storageDetail.images[0];
            return (
              <div className="card" style={{ marginTop: '1rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem' }}>
                  {t('manage.places.overlayDrawTitle')}
                </h3>
                <div className={styles.filterGrid} style={{ marginBottom: '0.75rem' }}>
                  <div className="field">
                    <label htmlFor="ov-img-select">{t('manage.places.overlayImageLabel')}</label>
                    <select
                      id="ov-img-select"
                      className="select"
                      value={activeImg.id}
                      onChange={(e) => setSelectedOverlayImageId(e.target.value)}
                    >
                      {storageDetail.images.map((im, i) => (
                        <option key={im.id} value={im.id}>
                          {im.caption || t('manage.places.overlayImageFallback', { index: i + 1 })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ov-label-input">{t('manage.places.overlayLabelInput')}</label>
                    <input
                      id="ov-label-input"
                      className="input"
                      placeholder={
                        editingPlaceId
                          ? plForm.name
                          : t('manage.places.overlayLabelPlaceholder')
                      }
                      value={overlayLabel}
                      onChange={(e) => setOverlayLabel(e.target.value)}
                    />
                  </div>
                </div>
                <ImageOverlayViewer
                  imageUrl={activeImg.url}
                  alt={activeImg.caption || storageDetail.name}
                  overlays={activeImg.overlays || []}
                  highlightTargetId={editingPlaceId}
                  drawMode
                  onDrawRect={(coords) =>
                    handleDrawOverlay(
                      activeImg.id,
                      editingPlaceId ? 'place' : 'general',
                      editingPlaceId || null,
                      coords,
                      editingPlaceId ? plForm.name : t('manage.places.overlayDefaultLabel')
                    )
                  }
                />
                {Array.isArray(activeImg.overlays) && activeImg.overlays.length > 0 && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {activeImg.overlays.map((ov) => (
                      <button
                        key={ov.id}
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          setError('');
                          try {
                            await api.deleteImageOverlay(ov.id);
                            await loadStorageDetail(selectedStorageId);
                          } catch (err) {
                            setError(err.message || t('app.error'));
                          }
                        }}
                      >
                        {t('manage.places.deleteOverlay', { label: ov.label || ov.targetKind })}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'items' && (
        <div className={styles.list}>
          <div className="card">
            <div className={styles.split}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="it-storage-select">{t('manage.items.selectStorage')}</label>
                <select
                  id="it-storage-select"
                  className="select"
                  value={selectedStorageId}
                  onChange={(e) => setSelectedStorageId(e.target.value)}
                >
                  {storages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="it-place-select">{t('manage.items.selectPlace')}</label>
                <select
                  id="it-place-select"
                  className="select"
                  value={selectedPlaceId}
                  onChange={(e) => setSelectedPlaceId(e.target.value)}
                >
                  {(storageDetail?.places || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.path?.join(' > ') || p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {activePlace && (
            <div className={styles.split}>
              <div className={styles.list}>
                <div className="card">
                  <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
                    {t('manage.items.itemsTitle')}
                  </h2>
                  <div className={styles.list}>
                    {(activePlace.items || []).map((it) => (
                      <div key={it.id} className={styles.rowCard}>
                        <div className={styles.rowTop}>
                          <strong>{it.name}</strong>
                          <StatusBadge status={it.status} />
                        </div>
                        <div className={styles.rowActions}>
                          <span className="badge badge-neutral">
                            {it.code || t('manage.items.noCode')}
                          </span>
                          {!it.code ? (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => handleIssueCode('item', it.id)}
                            >
                              {t('manage.items.issueCode')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-warn"
                              onClick={() => handleVoidCode(it.code)}
                            >
                              {t('manage.items.voidCode')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setEditingItemId(it.id);
                              setItemForm({
                                name: it.name,
                                description: it.description || '',
                                category: it.category || '',
                                status: it.status,
                                expiresOn: it.expiresOn || '',
                                minQuantity: it.minQuantity ?? '',
                                leaseable: Boolean(it.leaseable),
                              });
                            }}
                          >
                            {t('app.edit')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={async () => {
                              setError('');
                              try {
                                await api.deleteItem(it.id);
                                if (editingItemId === it.id) {
                                  setEditingItemId(null);
                                  setItemForm({
                                    name: '',
                                    description: '',
                                    category: '',
                                    status: 'ok',
                                    expiresOn: '',
                                    minQuantity: '',
                                    leaseable: false,
                                  });
                                }
                                await loadStorageDetail(selectedStorageId);
                              } catch (err) {
                                setError(err.message || t('app.error'));
                              }
                            }}
                          >
                            {t('app.delete')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
                    {t('manage.items.entriesTitle')}
                  </h2>
                  <div className={styles.list}>
                    {(activePlace.entries || []).map((en) => (
                      <div key={en.id} className={styles.rowCard}>
                        <div className={styles.rowTop}>
                          <strong>{en.name}</strong>
                          <StatusBadge status={en.status} />
                        </div>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setEditingEntryId(en.id);
                              setEntryForm({
                                name: en.name,
                                quantity: en.quantity ?? '',
                                quantityNote: en.quantityNote || '',
                                minQuantity: en.minQuantity ?? '',
                                expiresOn: en.expiresOn || '',
                                status: en.status,
                              });
                            }}
                          >
                            {t('app.edit')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={async () => {
                              setError('');
                              try {
                                await api.deleteEntry(activePlace.id, en.id);
                                await loadStorageDetail(selectedStorageId);
                              } catch (err) {
                                setError(err.message || t('app.error'));
                              }
                            }}
                          >
                            {t('app.delete')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.list}>
                <form className="card" onSubmit={handleSaveItem}>
                  <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
                    {editingItemId ? t('manage.items.editItem') : t('manage.items.newItem')}
                  </h2>
                  <div className="field">
                    <label htmlFor="item-name">{t('manage.items.name')}</label>
                    <input
                      id="item-name"
                      className="input"
                      required
                      value={itemForm.name}
                      onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="item-desc">{t('manage.items.description')}</label>
                    <textarea
                      id="item-desc"
                      className="textarea"
                      value={itemForm.description}
                      onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="item-category">{t('manage.items.category')}</label>
                    <input
                      id="item-category"
                      className="input"
                      value={itemForm.category}
                      onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="item-status">{t('manage.items.status')}</label>
                    <select
                      id="item-status"
                      className="select"
                      value={itemForm.status}
                      onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })}
                    >
                      {ITEM_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {t(`status.${st}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="item-expires">{t('manage.items.expiresOn')}</label>
                    <input
                      id="item-expires"
                      type="date"
                      className="input"
                      value={itemForm.expiresOn}
                      onChange={(e) => setItemForm({ ...itemForm, expiresOn: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="item-minq">{t('manage.items.minQuantity')}</label>
                    <input
                      id="item-minq"
                      type="number"
                      min="0"
                      className="input"
                      value={itemForm.minQuantity}
                      onChange={(e) => setItemForm({ ...itemForm, minQuantity: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(itemForm.leaseable)}
                        onChange={(e) => setItemForm({ ...itemForm, leaseable: e.target.checked })}
                      />
                      <span>{t('manage.items.leaseable')}</span>
                    </label>
                  </div>
                  <div className={styles.formActions}>
                    <button type="submit" className="btn btn-primary">
                      {t('app.save')}
                    </button>
                    {editingItemId && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setEditingItemId(null);
                          setItemForm({
                            name: '',
                            description: '',
                            category: '',
                            status: 'ok',
                            expiresOn: '',
                            minQuantity: '',
                            leaseable: false,
                          });
                        }}
                      >
                        {t('app.cancel')}
                      </button>
                    )}
                  </div>
                </form>

                {editingItemId && (() => {
                  const editingItem = (activePlace?.items || []).find((i) => i.id === editingItemId);
                  const itemImgs = editingItem?.images || [];
                  return (
                    <form className="card" onSubmit={handleUploadItemImage}>
                      <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem' }}>
                        {t('manage.items.itemImagesTitle', { count: itemImgs.length })}
                      </h3>
                      {itemImgs.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          {itemImgs.map((im) => (
                            <div key={im.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <img
                                src={im.url}
                                alt={editingItem?.name || ''}
                                style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6 }}
                              />
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={async () => {
                                  setError('');
                                  try {
                                    await api.deleteImage(im.id);
                                    await loadStorageDetail(selectedStorageId);
                                  } catch (err) {
                                    setError(err.message || t('app.error'));
                                  }
                                }}
                              >
                                {t('app.delete')}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="field">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => setItemImageFile(e.target.files?.[0] || null)}
                        />
                      </div>
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={!itemImageFile || uploading}
                      >
                        {t('manage.items.addItemImage')}
                      </button>
                    </form>
                  );
                })()}

                <form className="card" onSubmit={handleSaveEntry}>
                  <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
                    {editingEntryId ? t('manage.items.editEntry') : t('manage.items.newEntry')}
                  </h2>
                  <div className="field">
                    <label htmlFor="entry-name">{t('manage.items.name')}</label>
                    <input
                      id="entry-name"
                      className="input"
                      required
                      value={entryForm.name}
                      onChange={(e) => setEntryForm({ ...entryForm, name: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="entry-qty">{t('manage.items.quantity')}</label>
                    <input
                      id="entry-qty"
                      type="number"
                      min="0"
                      className="input"
                      value={entryForm.quantity}
                      onChange={(e) => setEntryForm({ ...entryForm, quantity: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="entry-qtynote">{t('manage.items.quantityNote')}</label>
                    <input
                      id="entry-qtynote"
                      className="input"
                      value={entryForm.quantityNote}
                      onChange={(e) => setEntryForm({ ...entryForm, quantityNote: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="entry-minq">{t('manage.items.minQuantity')}</label>
                    <input
                      id="entry-minq"
                      type="number"
                      min="0"
                      className="input"
                      value={entryForm.minQuantity}
                      onChange={(e) => setEntryForm({ ...entryForm, minQuantity: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="entry-expires">{t('manage.items.expiresOn')}</label>
                    <input
                      id="entry-expires"
                      type="date"
                      className="input"
                      value={entryForm.expiresOn}
                      onChange={(e) => setEntryForm({ ...entryForm, expiresOn: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="entry-status">{t('manage.items.status')}</label>
                    <select
                      id="entry-status"
                      className="select"
                      value={entryForm.status}
                      onChange={(e) => setEntryForm({ ...entryForm, status: e.target.value })}
                    >
                      {ENTRY_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {t(`status.${st}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.formActions}>
                    <button type="submit" className="btn btn-primary">
                      {t('app.save')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div className={styles.list}>
          <div className="card">
            <div className={styles.split}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="rep-status">{t('manage.reports.filterStatus')}</label>
                <select
                  id="rep-status"
                  className="select"
                  value={repFilter.status}
                  onChange={(e) => setRepFilter({ ...repFilter, status: e.target.value })}
                >
                  <option value="">{t('app.all')}</option>
                  {REPORT_STATUSES.map((rs) => (
                    <option key={rs} value={rs}>
                      {t(`reportStatus.${rs}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="rep-kind">{t('manage.reports.filterKind')}</label>
                <select
                  id="rep-kind"
                  className="select"
                  value={repFilter.kind}
                  onChange={(e) => setRepFilter({ ...repFilter, kind: e.target.value })}
                >
                  <option value="">{t('app.all')}</option>
                  {REPORT_KINDS.map((rk) => (
                    <option key={rk} value={rk}>
                      {t(`reportKind.${rk}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {reports.length === 0 ? (
            <p>{t('manage.reports.empty')}</p>
          ) : (
            reports.map((rep) => (
              <div key={rep.id} className={styles.rowCard}>
                <div className={styles.rowTop}>
                  <strong>
                    {t(`reportKind.${rep.kind}`)}: {rep.itemName || rep.entryName || rep.placeName || rep.placeId}
                  </strong>
                  <ReportStatusBadge status={rep.status} />
                </div>
                {rep.note && <p style={{ margin: 0 }}>{rep.note}</p>}
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {rep.reporterName && <span>{t('manage.reports.reporter', { name: rep.reporterName })}</span>}
                  <span>{t('manage.reports.votes', { count: rep.votes || 1 })}</span>
                  {rep.createdAt && <span>{formatDateTime(rep.createdAt)}</span>}
                </div>
                <div className={styles.rowActions}>
                  {rep.status === 'open' && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleReportAction(rep.id, 'ack')}
                    >
                      {t('manage.reports.ack')}
                    </button>
                  )}
                  {(rep.status === 'open' || rep.status === 'acknowledged') && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => handleReportAction(rep.id, 'resolve')}
                      >
                        {t('manage.reports.resolve')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleReportAction(rep.id, 'dismiss')}
                      >
                        {t('manage.reports.dismiss')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'leases' && (
        <div className={styles.list}>
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>{t('manage.leases.title')}</h2>
          {leasesForbidden ? (
            <div className="error-box">{t('manage.leases.adminOnly')}</div>
          ) : leases.length === 0 ? (
            <div className="card">{t('manage.leases.empty')}</div>
          ) : (
            leases.map((l) => (
              <div key={l.id} className={styles.rowCard}>
                <div className={styles.rowTop}>
                  <strong>
                    {l.itemName} — {l.borrowerName}
                  </strong>
                  <span className={`badge ${l.returnedAt ? 'badge-ok' : 'badge-warn'}`}>
                    {l.returnedAt
                      ? t('manage.leases.returned', { date: formatDateTime(l.returnedAt) })
                      : t('manage.leases.active')}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {l.storageName && <span>{l.storageName}</span>}
                  <span>{formatDateTime(l.leasedAt)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'privacy' && (
        <form className="card" onSubmit={handleSavePrivacy}>
          <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
            {t('manage.privacy.title')}
          </h2>
          <div className="field">
            <label htmlFor="priv-controller">{t('manage.privacy.controllerName')}</label>
            <input
              id="priv-controller"
              className="input"
              value={privacyForm.controllerName}
              onChange={(e) => setPrivacyForm({ ...privacyForm, controllerName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="priv-contact">{t('manage.privacy.controllerContact')}</label>
            <input
              id="priv-contact"
              className="input"
              value={privacyForm.controllerContact}
              onChange={(e) => setPrivacyForm({ ...privacyForm, controllerContact: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="priv-retention">{t('manage.privacy.leaseRetentionDays')}</label>
            <input
              id="priv-retention"
              type="number"
              min={1}
              max={3650}
              className="input"
              value={privacyForm.leaseRetentionDays}
              onChange={(e) =>
                setPrivacyForm({ ...privacyForm, leaseRetentionDays: Number(e.target.value) || 365 })
              }
            />
          </div>

          <div className="field">
            <label>{t('manage.privacy.processorsTitle')}</label>
            <div className={styles.list}>
              {privacyForm.processors.map((proc, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <input
                    className="input"
                    style={{ flex: '1 1 140px' }}
                    placeholder={t('manage.privacy.processorName')}
                    value={proc.name}
                    onChange={(e) => {
                      const next = [...privacyForm.processors];
                      next[idx] = { ...proc, name: e.target.value };
                      setPrivacyForm({ ...privacyForm, processors: next });
                    }}
                  />
                  <input
                    className="input"
                    style={{ flex: '1 1 180px' }}
                    placeholder={t('manage.privacy.processorPurpose')}
                    value={proc.purpose}
                    onChange={(e) => {
                      const next = [...privacyForm.processors];
                      next[idx] = { ...proc, purpose: e.target.value };
                      setPrivacyForm({ ...privacyForm, processors: next });
                    }}
                  />
                  <input
                    className="input"
                    style={{ flex: '1 1 100px' }}
                    placeholder={t('manage.privacy.processorLocation')}
                    value={proc.location}
                    onChange={(e) => {
                      const next = [...privacyForm.processors];
                      next[idx] = { ...proc, location: e.target.value };
                      setPrivacyForm({ ...privacyForm, processors: next });
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() =>
                      setPrivacyForm({
                        ...privacyForm,
                        processors: privacyForm.processors.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    {t('app.delete')}
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setPrivacyForm({
                      ...privacyForm,
                      processors: [...privacyForm.processors, { name: '', purpose: '', location: '' }],
                    })
                  }
                >
                  {t('manage.privacy.addProcessor')}
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="priv-extra">{t('manage.privacy.privacyExtra')}</label>
            <textarea
              id="priv-extra"
              className="textarea"
              value={privacyForm.privacyExtra}
              onChange={(e) => setPrivacyForm({ ...privacyForm, privacyExtra: e.target.value })}
            />
          </div>

          <div className={styles.formActions}>
            <button type="submit" className="btn btn-primary">
              {t('app.save')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
