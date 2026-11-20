/**
 * Mail delivery abstraction supporting:
 * - console (dev/test logging)
 * - brevo (Brevo HTTP v3 SMTP API)
 * - oidc (offload email sending to the OIDC/Tunnus mail relay endpoint)
 */

/**
 * Send an email using the configured mail provider.
 * @param {import('./config.js').AppConfig} config
 * @param {import('pino').Logger | undefined} logger
 * @param {{
 *   to: string[],
 *   subject: string,
 *   text: string,
 *   html?: string,
 *   templateId?: number | null,
 *   params?: Record<string, any>
 * }} message
 * @returns {Promise<{ ok: boolean, provider: string, error?: string }>}
 */
export async function sendMail(config, logger, message) {
  const recipients = (message.to || []).map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) {
    return { ok: true, provider: config.mailProvider };
  }

  if (config.mailProvider === 'console') {
    logger?.info({ to: recipients, subject: message.subject }, 'Console mail');
    return { ok: true, provider: 'console' };
  }

  if (config.mailProvider === 'brevo') {
    if (!config.brevoApiKey) {
      return { ok: false, provider: 'brevo', error: 'BREVO_API_KEY is not configured' };
    }
    const payload = {
      sender: { email: config.mailFrom, name: 'Tavaranpaikka' },
      to: recipients.map((email) => ({ email })),
      subject: message.subject,
      textContent: message.text,
      ...(message.html ? { htmlContent: message.html } : {}),
      ...(message.templateId
        ? { templateId: message.templateId, params: message.params || {} }
        : {}),
    };
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.brevoApiKey,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, provider: 'brevo', error: `Brevo HTTP ${res.status}: ${errText}` };
      }
      return { ok: true, provider: 'brevo' };
    } catch (err) {
      return {
        ok: false,
        provider: 'brevo',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (config.mailProvider === 'oidc') {
    if (!config.oidcMailEndpoint) {
      return { ok: false, provider: 'oidc', error: 'OIDC_MAIL_ENDPOINT is not configured' };
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (config.oidcMailToken) {
        headers['Authorization'] = `Bearer ${config.oidcMailToken}`;
      }
      const res = await fetch(config.oidcMailEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: config.mailFrom,
          to: recipients,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, provider: 'oidc', error: `OIDC mail HTTP ${res.status}: ${errText}` };
      }
      return { ok: true, provider: 'oidc' };
    } catch (err) {
      return {
        ok: false,
        provider: 'oidc',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { ok: false, provider: config.mailProvider, error: 'Unknown MAIL_PROVIDER' };
}
