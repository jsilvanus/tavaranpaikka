import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { sendMail } from '../src/mail.js';

describe('sendMail (Brevo + OIDC relay)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Brevo-compatible templateId and params via OIDC mail relay', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = loadConfig({
      MAIL_PROVIDER: 'oidc',
      MAIL_FROM: 'tavaranpaikka@riihimaenseurakunta.fi',
      OIDC_MAIL_ENDPOINT: 'https://tunnus.example.fi/api/internal/mail',
      OIDC_MAIL_TOKEN: 'relay-secret',
      BREVO_TEMPLATE_REPORT_ID: '42',
    });

    const res = await sendMail(config, undefined, {
      to: ['keeper@example.fi'],
      subject: '[Tavaranpaikka] Uusi ilmoitus',
      text: 'Lyijykynät loppu',
      html: '<p>Lyijykynät loppu</p>',
      templateId: config.brevoTemplateReportId,
      params: { targetName: 'Lyijykynät', storageName: 'Päävarasto' },
    });

    expect(res).toEqual({ ok: true, provider: 'oidc' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://tunnus.example.fi/api/internal/mail');
    expect(init.headers.Authorization).toBe('Bearer relay-secret');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      from: 'tavaranpaikka@riihimaenseurakunta.fi',
      to: ['keeper@example.fi'],
      subject: '[Tavaranpaikka] Uusi ilmoitus',
      text: 'Lyijykynät loppu',
      html: '<p>Lyijykynät loppu</p>',
      templateId: 42,
      params: { targetName: 'Lyijykynät', storageName: 'Päävarasto' },
    });
  });

  it('sends via Brevo HTTP v3 API with templateId and params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = loadConfig({
      MAIL_PROVIDER: 'brevo',
      MAIL_FROM: 'tavaranpaikka@riihimaenseurakunta.fi',
      BREVO_API_KEY: 'xkeysib-test',
    });

    const res = await sendMail(config, undefined, {
      to: ['keeper@example.fi'],
      subject: 'Testi',
      text: 'Teksti',
      templateId: 7,
      params: { kind: 'depleted' },
    });

    expect(res).toEqual({ ok: true, provider: 'brevo' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('xkeysib-test');
    const body = JSON.parse(init.body);
    expect(body.templateId).toBe(7);
    expect(body.params).toEqual({ kind: 'depleted' });
  });
});
