import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, getBasePath, withBasePath } from '../src/api/client.js';

describe('client basePath helpers', () => {
  beforeEach(() => {
    delete window.__BASE_PATH__;
  });

  afterEach(() => {
    delete window.__BASE_PATH__;
    vi.restoreAllMocks();
  });

  it('reads window.__BASE_PATH__ and normalizes trailing slashes', () => {
    expect(getBasePath()).toBe('');
    window.__BASE_PATH__ = '/tavara';
    expect(getBasePath()).toBe('/tavara');
    window.__BASE_PATH__ = '/tavara/';
    expect(getBasePath()).toBe('/tavara');
  });

  it('prefixes root-relative paths with basePath idempotently', () => {
    window.__BASE_PATH__ = '/tavara';
    expect(withBasePath('/api/me')).toBe('/tavara/api/me');
    expect(withBasePath('/tavara/api/me')).toBe('/tavara/api/me');
    expect(withBasePath('/api/files/abc.jpg')).toBe('/tavara/api/files/abc.jpg');
    expect(withBasePath('https://example.com/img.png')).toBe('https://example.com/img.png');
    expect(withBasePath('data:image/svg+xml;utf8,<svg/>')).toBe('data:image/svg+xml;utf8,<svg/>');
  });

  it('prefixes API fetch calls and URL builders when __BASE_PATH__ is set', async () => {
    window.__BASE_PATH__ = '/tavara';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ storages: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.getPublicStorages();
    expect(fetchMock).toHaveBeenCalledWith('/tavara/api/public/storages', expect.any(Object));
    expect(api.getStorageSummaryPdfUrl('st-1')).toBe('/tavara/api/storages/st-1/summary.pdf');
    expect(api.getQrSvgUrl('AB12', true)).toBe('/tavara/api/labels/qr/AB12.svg?logo=1');
  });
});
