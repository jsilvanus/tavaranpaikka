import { t } from '../i18n/index.js';

export function StatusBadge({ status }) {
  const cls =
    status === 'ok'
      ? 'badge-ok'
      : status === 'depleted'
        ? 'badge-warn'
        : status === 'broken' || status === 'expired'
          ? 'badge-danger'
          : 'badge-neutral';

  return <span className={`badge ${cls}`}>{t(`status.${status}`)}</span>;
}

export function StorageKindBadge({ kind }) {
  return <span className="badge badge-neutral">{t(`storageKind.${kind}`)}</span>;
}

export function ReportStatusBadge({ status }) {
  const cls =
    status === 'open'
      ? 'badge-danger'
      : status === 'acknowledged'
        ? 'badge-warn'
        : status === 'resolved'
          ? 'badge-ok'
          : 'badge-neutral';
  return <span className={`badge ${cls}`}>{t(`reportStatus.${status}`)}</span>;
}
