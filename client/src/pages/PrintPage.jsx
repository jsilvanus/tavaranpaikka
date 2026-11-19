import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { t } from '../i18n/index.js';
import styles from './PrintPage.module.css';

const LAYOUT_SPECS = {
  'a4-3x8': { cols: 3, rows: 8, total: 24 },
  'a4-5x13': { cols: 5, rows: 13, total: 65 },
  'a4-2x7': { cols: 2, rows: 7, total: 14 },
  'a4-1x1': { cols: 1, rows: 1, total: 1 },
};

function targetKey(tgt) {
  return `${tgt.kind}:${tgt.id}`;
}

export default function PrintPage() {
  const [searchParams] = useSearchParams();
  const initialStorageId = searchParams.get('storageId') || '';

  const [storages, setStorages] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [storageId, setStorageId] = useState(initialStorageId);
  const [kindFilter, setKindFilter] = useState('');
  const [notPrinted, setNotPrinted] = useState(false);
  const [search, setSearch] = useState('');

  // Selection & per-row overrides
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [overrides, setOverrides] = useState({}); // { [key]: { name?: boolean, place?: boolean } }

  // Global label options
  const [showQr, setShowQr] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showName, setShowName] = useState(true);
  const [showPlace, setShowPlace] = useState(true);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [layout, setLayout] = useState('a4-3x8');
  const [startPosition, setStartPosition] = useState(1);
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useState('normal');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.getPublicStorages().then(setStorages).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .getLabelTargets({
        storageId,
        kind: kindFilter,
        notPrinted,
        q: search.trim(),
      })
      .then((list) => {
        if (!active) return;
        setTargets(Array.isArray(list) ? list : []);
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
  }, [storageId, kindFilter, notPrinted, search]);

  function toggleSelect(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelectedKeys(new Set(targets.map(targetKey)));
  }

  function selectNone() {
    setSelectedKeys(new Set());
  }

  function toggleRowOverride(key, field, globalVal) {
    setOverrides((prev) => {
      const current = prev[key] || {};
      const effective = current[field] !== undefined ? current[field] : globalVal;
      return {
        ...prev,
        [key]: {
          ...current,
          [field]: !effective,
        },
      };
    });
  }

  const selectedTargets = useMemo(() => {
    return targets.filter((tgt) => selectedKeys.has(targetKey(tgt)));
  }, [targets, selectedKeys]);

  const layoutSpec = LAYOUT_SPECS[layout] || LAYOUT_SPECS['a4-3x8'];

  const sheetCells = useMemo(() => {
    const startIdx = Math.max(1, Math.min(layoutSpec.total, Number(startPosition) || 1)) - 1;
    const copyCount = Math.max(1, Number(copies) || 1);
    const expanded = [];

    for (const tgt of selectedTargets) {
      const key = targetKey(tgt);
      const ov = overrides[key] || {};
      const effName = ov.name !== undefined ? ov.name : showName;
      const effPlace = ov.place !== undefined ? ov.place : showPlace;
      for (let c = 0; c < copyCount; c++) {
        expanded.push({
          tgt,
          effName,
          effPlace,
          cellKey: `${key}-${c}`,
        });
      }
    }

    const cells = [];
    for (let i = 0; i < startIdx; i++) {
      cells.push({ empty: true, cellKey: `empty-${i}` });
    }
    for (const item of expanded) {
      cells.push({ empty: false, ...item });
    }
    return cells;
  }, [selectedTargets, overrides, showName, showPlace, startPosition, copies, layoutSpec.total]);

  const sheets = useMemo(() => {
    const pages = [];
    const perPage = layoutSpec.total;
    for (let i = 0; i < sheetCells.length; i += perPage) {
      const slice = sheetCells.slice(i, i + perPage);
      while (slice.length < perPage) {
        slice.push({ empty: true, cellKey: `pad-${i}-${slice.length}` });
      }
      pages.push(slice);
    }
    if (pages.length === 0) {
      pages.push(
        Array.from({ length: perPage }, (_, idx) => ({ empty: true, cellKey: `blank-${idx}` }))
      );
    }
    return pages;
  }, [sheetCells, layoutSpec.total]);

  async function handleDownloadPdf() {
    if (selectedTargets.length === 0) return;
    setDownloading(true);
    setError('');
    try {
      const payload = {
        targets: selectedTargets.map((tgt) => {
          const ov = overrides[targetKey(tgt)];
          return ov ? { kind: tgt.kind, id: tgt.id, show: ov } : { kind: tgt.kind, id: tgt.id };
        }),
        layout,
        startPosition: Number(startPosition) || 1,
        copies: Number(copies) || 1,
        size,
        show: {
          qr: showQr,
          code: showCode,
          name: showName,
          place: showPlace,
          note: showNote,
        },
        note: showNote ? noteText : undefined,
      };
      const blob = await api.generateLabelsPdf(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tarrat-${layout}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || t('app.error'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section>
      <h1 className="no-print" style={{ margin: '0 0 1rem 0', fontSize: '1.5rem' }}>
        {t('print.title')}
      </h1>

      {error && <div className="error-box no-print">{error}</div>}

      <div className={styles.layout}>
        <div className={`${styles.controlsCol} no-print`}>
          <div className="card">
            <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
              {t('print.targetsTitle')}
            </h2>

            <div className={styles.filterGrid}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="print-storage">{t('print.filterStorage')}</label>
                <select
                  id="print-storage"
                  className="select"
                  value={storageId}
                  onChange={(e) => setStorageId(e.target.value)}
                >
                  <option value="">{t('app.all')}</option>
                  {storages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="print-kind">{t('print.filterKind')}</label>
                <select
                  id="print-kind"
                  className="select"
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                >
                  <option value="">{t('app.all')}</option>
                  <option value="item">{t('codeKind.item')}</option>
                  <option value="place">{t('codeKind.place')}</option>
                  <option value="storage">{t('codeKind.storage')}</option>
                </select>
              </div>
            </div>

            <div className="field" style={{ marginTop: '0.65rem' }}>
              <input
                type="search"
                className="input"
                placeholder={t('print.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('print.searchPlaceholder')}
              />
            </div>

            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={notPrinted}
                onChange={(e) => setNotPrinted(e.target.checked)}
              />
              <span>{t('print.onlyNotPrinted')}</span>
            </label>

            <div className={styles.actionRow} style={{ marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-sm" onClick={selectAll}>
                {t('print.selectAll')}
              </button>
              <button type="button" className="btn btn-sm" onClick={selectNone}>
                {t('print.selectNone')}
              </button>
              <span style={{ alignSelf: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {t('print.selectedCount', { count: selectedTargets.length })}
              </span>
            </div>

            {loading ? (
              <p>{t('app.loading')}</p>
            ) : (
              <div className={styles.targetList} data-testid="print-target-list">
                {targets.map((tgt) => {
                  const key = targetKey(tgt);
                  const isChecked = selectedKeys.has(key);
                  const ov = overrides[key] || {};
                  const effName = ov.name !== undefined ? ov.name : showName;
                  const effPlace = ov.place !== undefined ? ov.place : showPlace;
                  const placeStr =
                    tgt.kind === 'item'
                      ? [tgt.storageName, ...(tgt.placePath || [])].filter(Boolean).join(' > ')
                      : tgt.storageName;

                  return (
                    <div key={key} className={styles.targetRow}>
                      <label className={styles.targetMain}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(key)}
                        />
                        <span className={styles.targetInfo}>
                          <strong>{tgt.name}</strong>
                          <span className={styles.targetMeta}>
                            {t(`codeKind.${tgt.kind}`)}
                            {tgt.code ? ` · ${tgt.code}` : ''}
                            {placeStr ? ` · ${placeStr}` : ''}
                          </span>
                        </span>
                      </label>

                      <div className={styles.overrides}>
                        <label className={styles.overrideLabel}>
                          <input
                            type="checkbox"
                            checked={effName}
                            onChange={() => toggleRowOverride(key, 'name', showName)}
                            aria-label={`${tgt.name} ${t('print.overrideName')}`}
                          />
                          <span>{t('print.overrideName')}</span>
                        </label>
                        <label className={styles.overrideLabel}>
                          <input
                            type="checkbox"
                            checked={effPlace}
                            onChange={() => toggleRowOverride(key, 'place', showPlace)}
                            aria-label={`${tgt.name} ${t('print.overridePlace')}`}
                          />
                          <span>{t('print.overridePlace')}</span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
              {t('print.optionsTitle')}
            </h2>

            <div className={styles.togglesGrid}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={showQr}
                  onChange={(e) => setShowQr(e.target.checked)}
                />
                <span>{t('print.showQr')}</span>
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={showCode}
                  onChange={(e) => setShowCode(e.target.checked)}
                />
                <span>{t('print.showCode')}</span>
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={showName}
                  onChange={(e) => setShowName(e.target.checked)}
                />
                <span>{t('print.showName')}</span>
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={showPlace}
                  onChange={(e) => setShowPlace(e.target.checked)}
                />
                <span>{t('print.showPlace')}</span>
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={showNote}
                  onChange={(e) => setShowNote(e.target.checked)}
                />
                <span>{t('print.showNote')}</span>
              </label>
            </div>

            {showNote && (
              <div className="field">
                <input
                  type="text"
                  className="input"
                  placeholder={t('print.notePlaceholder')}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
              </div>
            )}

            <div className={styles.filterGrid}>
              <div className="field">
                <label htmlFor="print-layout">{t('print.layoutLabel')}</label>
                <select
                  id="print-layout"
                  className="select"
                  value={layout}
                  onChange={(e) => {
                    setLayout(e.target.value);
                    setStartPosition(1);
                  }}
                >
                  {Object.keys(LAYOUT_SPECS).map((k) => (
                    <option key={k} value={k}>
                      {t(`print.layouts.${k}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="print-size">{t('print.sizeLabel')}</label>
                <select
                  id="print-size"
                  className="select"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                >
                  <option value="small">{t('print.sizes.small')}</option>
                  <option value="normal">{t('print.sizes.normal')}</option>
                  <option value="large">{t('print.sizes.large')}</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="print-start">
                  {t('print.startPosition', { max: layoutSpec.total })}
                </label>
                <input
                  id="print-start"
                  type="number"
                  min={1}
                  max={layoutSpec.total}
                  className="input"
                  value={startPosition}
                  onChange={(e) => setStartPosition(Number(e.target.value) || 1)}
                />
              </div>

              <div className="field">
                <label htmlFor="print-copies">{t('print.copies')}</label>
                <input
                  id="print-copies"
                  type="number"
                  min={1}
                  max={50}
                  className="input"
                  value={copies}
                  onChange={(e) => setCopies(Number(e.target.value) || 1)}
                />
              </div>
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={selectedTargets.length === 0 || downloading}
                onClick={handleDownloadPdf}
              >
                {downloading ? t('print.downloadingPdf') : t('print.downloadPdf')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={selectedTargets.length === 0}
                onClick={() => window.print()}
              >
                {t('print.browserPrint')}
              </button>
            </div>
          </div>
        </div>

        <div>
          <h2 className="no-print" style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>
            {t('print.previewTitle')}
          </h2>

          {selectedTargets.length === 0 && (
            <p className="no-print" style={{ color: 'var(--text-muted)' }}>
              {t('print.noTargetsSelected')}
            </p>
          )}

          <div className={`${styles.previewWrap} print-only-sheet`} data-testid="print-preview">
            {sheets.map((cells, pageIdx) => (
              <div
                key={`sheet-${pageIdx}`}
                className={`${styles.sheet} ${styles[`sheet-${layout}`]}`}
                data-layout={layout}
              >
                {cells.map((cell) => {
                  if (cell.empty) {
                    return (
                      <div
                        key={cell.cellKey}
                        className={`${styles.cell} ${layout === 'a4-1x1' ? styles['cell-a4-1x1'] : ''}`}
                      />
                    );
                  }
                  const { tgt, effName, effPlace } = cell;
                  const placeStr =
                    tgt.kind === 'item'
                      ? [tgt.storageName, ...(tgt.placePath || [])].filter(Boolean).join(' > ')
                      : tgt.kind === 'place'
                        ? tgt.storageName
                        : '';

                  return (
                    <div
                      key={cell.cellKey}
                      className={`${styles.cell} ${layout === 'a4-1x1' ? styles['cell-a4-1x1'] : ''}`}
                      data-testid="label-cell"
                    >
                      {showQr && tgt.code && (
                        <img
                          src={api.getQrSvgUrl(tgt.code)}
                          alt={tgt.code}
                          className={styles.qrImg}
                        />
                      )}
                      <div className={`${styles.cellText} ${styles[`size-${size}`]}`}>
                        {effName && <div className={styles.labelName}>{tgt.name}</div>}
                        {effPlace && placeStr && (
                          <div className={styles.labelPlace}>{placeStr}</div>
                        )}
                        {showCode && tgt.code && (
                          <div className={styles.labelCode}>{tgt.code}</div>
                        )}
                        {showNote && noteText && (
                          <div className={styles.labelNote}>{noteText}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
