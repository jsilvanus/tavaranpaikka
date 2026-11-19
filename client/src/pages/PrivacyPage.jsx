import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { t } from '../i18n/index.js';

export default function PrivacyPage() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.getPublicPrivacy().then(setInfo).catch(() => {});
  }, []);

  const leaseDays = info?.leaseRetentionDays ?? 365;
  const processors = Array.isArray(info?.processors) ? info.processors : [];

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <h1 style={{ margin: '0 0 0.75rem 0', fontSize: '1.5rem' }}>{t('privacy.title')}</h1>
        <p style={{ margin: 0 }}>{t('privacy.body')}</p>
      </div>

      {info && (
        <div className="card">
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>
            {t('privacy.controllerTitle')}
          </h2>
          <p style={{ margin: '0 0 0.25rem 0' }}>
            <strong>{info.controllerName || info.organizationName}</strong>
          </p>
          {info.controllerContact && (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>{info.controllerContact}</p>
          )}
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
          {t('privacy.retentionTitle')}
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '0.5rem' }}>{t('privacy.retentionData')}</th>
              <th style={{ padding: '0.5rem' }}>{t('privacy.retentionBasis')}</th>
              <th style={{ padding: '0.5rem' }}>{t('privacy.retentionPeriod')}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.leasesData')}</td>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.leasesBasis')}</td>
              <td style={{ padding: '0.5rem' }}>
                {t('privacy.retentionRows.leasesPeriod', { days: leaseDays })}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.reportsData')}</td>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.reportsBasis')}</td>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.reportsPeriod')}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.usersData')}</td>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.usersBasis')}</td>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.usersPeriod')}</td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.auditData')}</td>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.auditBasis')}</td>
              <td style={{ padding: '0.5rem' }}>{t('privacy.retentionRows.auditPeriod')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>
          {t('privacy.processorsTitle')}
        </h2>
        {processors.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('privacy.processorsEmpty')}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.5rem' }}>{t('privacy.processorName')}</th>
                <th style={{ padding: '0.5rem' }}>{t('privacy.processorPurpose')}</th>
                <th style={{ padding: '0.5rem' }}>{t('privacy.processorLocation')}</th>
              </tr>
            </thead>
            <tbody>
              {processors.map((p, idx) => (
                <tr key={`${p.name}-${idx}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.5rem' }}>{p.name}</td>
                  <td style={{ padding: '0.5rem' }}>{p.purpose}</td>
                  <td style={{ padding: '0.5rem' }}>{p.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {info?.privacyExtra && (
        <div className="card">
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>
            {t('privacy.extraTitle')}
          </h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{info.privacyExtra}</p>
        </div>
      )}
    </section>
  );
}
