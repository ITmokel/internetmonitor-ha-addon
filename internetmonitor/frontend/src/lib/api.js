const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let msg = `API error: ${response.status}`;
    try { const body = await response.json(); if (body.error) msg = `${response.status}: ${body.error}`; } catch {}
    throw new Error(msg);
  }

  return response.json();
}

export const api = {
  // Status
  getStatus: () => request('/status'),

  // Dashboard
  getDashboard: (hours = 24) => request(`/dashboard?hours=${hours}`),
  getDashboardPingChart: (hours = 24) => request(`/dashboard/ping-chart?hours=${hours}`),

  // Config
  getConfig: () => request('/config'),
  setConfig: (key, value) => request('/config', {
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  }),

  // Ping targets
  getTargets: () => request('/targets'),
  addTarget: (name, host) => request('/targets', {
    method: 'POST',
    body: JSON.stringify({ name, host }),
  }),
  updateTarget: (id, data) => request(`/targets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteTarget: (id) => request(`/targets/${id}`, {
    method: 'DELETE',
  }),

  // Ping
  getPingResults: (hours = 24) => request(`/ping/results?hours=${hours}`),
  getLatestPing: () => request('/ping/latest'),
  runPing: () => request('/ping/run', { method: 'POST' }),
  testPing: (host) => request('/ping/test', {
    method: 'POST',
    body: JSON.stringify({ host }),
  }),

  // Speedtest
  getSpeedtestResults: (hours = 168) => request(`/speedtest/results?hours=${hours}`),
  getLatestSpeedtest: () => request('/speedtest/latest'),
  runSpeedtest: () => request('/speedtest/run', { method: 'POST' }),

  // DNS
  getDnsResults: (hours = 24) => request(`/dns/results?hours=${hours}`),
  getLatestDns: () => request('/dns/latest'),
  runDns: () => request('/dns/run', { method: 'POST' }),

  // Public IP
  getPublicIp: () => request('/publicip/current'),
  getPublicIpHistory: (days = 30) => request(`/publicip/history?days=${days}`),
  checkPublicIp: () => request('/publicip/check', { method: 'POST' }),

  // Reports
  getReports: (period = '7d') => request(`/reports?period=${period}`),

  // Cleanup
  cleanup: () => request('/cleanup', { method: 'POST' }),
};

export default api;
