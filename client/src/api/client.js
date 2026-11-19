import { mockApi, generateMockQrSvgDataUrl } from './mock.js';

const DEV_ROLE_KEY = 'tavaranpaikka_dev_role';

export function isMockMode() {
  return import.meta.env.VITE_MOCK === '1';
}

export function getDevRole() {
  try {
    return localStorage.getItem(DEV_ROLE_KEY) || '';
  } catch {
    return '';
  }
}

export function setDevRole(role) {
  try {
    if (role) {
      localStorage.setItem(DEV_ROLE_KEY, role);
    } else {
      localStorage.removeItem(DEV_ROLE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const devRole = getDevRole();
  if (devRole) {
    headers.set('X-Dev-Role', devRole);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code = 'HTTP_ERROR';
    try {
      const data = await res.json();
      if (data?.error?.message) message = data.error.message;
      if (data?.error?.code) code = data.error.code;
    } catch {
      // ignore non-json error bodies
    }
    const err = new Error(message);
    err.status = res.status;
    err.code = code;
    throw err;
  }

  if (options.responseType === 'blob') {
    return res.blob();
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) {
      search.set(k, String(v));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const api = {
  // Public
  getPublicStorages(params) {
    if (isMockMode()) return mockApi.getPublicStorages(params);
    return request(`/api/public/storages${toQuery(params)}`);
  },
  getPublicStorage(id) {
    if (isMockMode()) return mockApi.getPublicStorage(id);
    return request(`/api/public/storages/${encodeURIComponent(id)}`);
  },
  resolveCode(code) {
    if (isMockMode()) return mockApi.resolveCode(code);
    return request(`/api/public/codes/${encodeURIComponent(code)}`);
  },
  createPublicReport(placeId, body) {
    if (isMockMode()) return mockApi.createPublicReport(placeId, body);
    return request(`/api/public/places/${encodeURIComponent(placeId)}/reports`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  votePublicReport(reportId) {
    if (isMockMode()) return mockApi.votePublicReport(reportId);
    return request(`/api/public/reports/${encodeURIComponent(reportId)}/vote`, {
      method: 'POST',
    });
  },

  // Keeper
  getMe() {
    if (isMockMode()) return mockApi.getMe();
    return request('/api/me');
  },
  getStorages() {
    if (isMockMode()) return mockApi.getStorages();
    return request('/api/storages');
  },
  getStorage(id) {
    if (isMockMode()) return mockApi.getStorage(id);
    return request(`/api/storages/${encodeURIComponent(id)}`);
  },
  createStorage(data) {
    if (isMockMode()) return mockApi.createStorage(data);
    return request('/api/storages', { method: 'POST', body: JSON.stringify(data) });
  },
  updateStorage(id, data) {
    if (isMockMode()) return mockApi.updateStorage(id, data);
    return request(`/api/storages/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deleteStorage(id) {
    if (isMockMode()) return mockApi.deleteStorage(id);
    return request(`/api/storages/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  uploadStorageImage(id, file) {
    if (isMockMode()) return mockApi.uploadStorageImage(id, file);
    const form = new FormData();
    form.append('image', file);
    return request(`/api/storages/${encodeURIComponent(id)}/image`, {
      method: 'POST',
      body: form,
    });
  },
  uploadStorageLogo(id, file) {
    if (isMockMode()) return mockApi.uploadStorageLogo?.(id, file) ?? Promise.resolve({});
    const form = new FormData();
    form.append('logo', file);
    return request(`/api/storages/${encodeURIComponent(id)}/logo`, {
      method: 'POST',
      body: form,
    });
  },
  deleteStorageLogo(id) {
    if (isMockMode()) return mockApi.deleteStorageLogo?.(id) ?? Promise.resolve({});
    return request(`/api/storages/${encodeURIComponent(id)}/logo`, { method: 'DELETE' });
  },
  getOrganizationLogo() {
    if (isMockMode()) return Promise.resolve({ logoUrl: null });
    return request('/api/organization/logo');
  },
  uploadOrganizationLogo(file) {
    if (isMockMode()) return Promise.resolve({ logoUrl: null });
    const form = new FormData();
    form.append('logo', file);
    return request('/api/organization/logo', {
      method: 'POST',
      body: form,
    });
  },
  deleteOrganizationLogo() {
    if (isMockMode()) return Promise.resolve({ logoUrl: null });
    return request('/api/organization/logo', { method: 'DELETE' });
  },
  inspectStorage(id) {
    if (isMockMode()) return mockApi.inspectStorage(id);
    return request(`/api/storages/${encodeURIComponent(id)}/inspect`, { method: 'POST' });
  },
  getStorageSummaryPdfUrl(id) {
    return `/api/storages/${encodeURIComponent(id)}/summary.pdf`;
  },

  getPlaces(params) {
    if (isMockMode()) return mockApi.getPlaces(params);
    return request(`/api/places${toQuery(params)}`);
  },
  createPlace(data) {
    if (isMockMode()) return mockApi.createPlace(data);
    return request('/api/places', { method: 'POST', body: JSON.stringify(data) });
  },
  updatePlace(id, data) {
    if (isMockMode()) return mockApi.updatePlace(id, data);
    return request(`/api/places/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deletePlace(id) {
    if (isMockMode()) return mockApi.deletePlace(id);
    return request(`/api/places/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  createEntry(placeId, data) {
    if (isMockMode()) return mockApi.createEntry(placeId, data);
    return request(`/api/places/${encodeURIComponent(placeId)}/entries`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateEntry(placeId, entryId, data) {
    if (isMockMode()) return mockApi.updateEntry(placeId, entryId, data);
    return request(`/api/places/${encodeURIComponent(placeId)}/entries/${encodeURIComponent(entryId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deleteEntry(placeId, entryId) {
    if (isMockMode()) return mockApi.deleteEntry(placeId, entryId);
    return request(`/api/places/${encodeURIComponent(placeId)}/entries/${encodeURIComponent(entryId)}`, {
      method: 'DELETE',
    });
  },

  getItems(params) {
    if (isMockMode()) return mockApi.getItems(params);
    return request(`/api/items${toQuery(params)}`);
  },
  createItem(data) {
    if (isMockMode()) return mockApi.createItem(data);
    return request('/api/items', { method: 'POST', body: JSON.stringify(data) });
  },
  updateItem(id, data) {
    if (isMockMode()) return mockApi.updateItem(id, data);
    return request(`/api/items/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deleteItem(id) {
    if (isMockMode()) return mockApi.deleteItem(id);
    return request(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  moveItem(id, placeId) {
    if (isMockMode()) return mockApi.moveItem(id, placeId);
    return request(`/api/items/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ placeId }),
    });
  },

  getReports(params) {
    if (isMockMode()) return mockApi.getReports(params);
    return request(`/api/reports${toQuery(params)}`);
  },
  ackReport(id) {
    if (isMockMode()) return mockApi.ackReport(id);
    return request(`/api/reports/${encodeURIComponent(id)}/ack`, { method: 'POST' });
  },
  resolveReport(id) {
    if (isMockMode()) return mockApi.resolveReport(id);
    return request(`/api/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
  },
  dismissReport(id) {
    if (isMockMode()) return mockApi.dismissReport(id);
    return request(`/api/reports/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  },

  issueCode(kind, targetId) {
    if (isMockMode()) return mockApi.issueCode(kind, targetId);
    return request('/api/codes', {
      method: 'POST',
      body: JSON.stringify({ kind, targetId }),
    });
  },
  voidCode(code) {
    if (isMockMode()) return mockApi.voidCode(code);
    return request(`/api/codes/${encodeURIComponent(code)}/void`, { method: 'POST' });
  },

  getLabelTargets(params) {
    if (isMockMode()) return mockApi.getLabelTargets(params);
    return request(`/api/labels/targets${toQuery(params)}`);
  },
  generateLabelsPdf(labelRequest) {
    if (isMockMode()) return mockApi.generateLabelsPdf(labelRequest);
    return request('/api/labels/pdf', {
      method: 'POST',
      body: JSON.stringify(labelRequest),
      responseType: 'blob',
    });
  },
  getQrSvgUrl(code, showLogo = true) {
    if (!code) return '';
    if (isMockMode()) return generateMockQrSvgDataUrl(code);
    return `/api/labels/qr/${encodeURIComponent(code)}.svg?logo=${showLogo ? '1' : '0'}`;
  },
};
