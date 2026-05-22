import { Router } from 'express';
import * as db from '../database.js';

const SPEEDTEST_CHART_LIMIT = 50;

// Simple in-memory rate limiter for expensive / destructive endpoints
const rateBuckets = new Map();
function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.reset) b = { count: 0, reset: now + windowMs };
  b.count++;
  rateBuckets.set(key, b);
  return b.count <= maxRequests;
}

// Clamp the hours query param to 5 min – 1 year
function parseHours(query) {
  return Math.min(Math.max(parseFloat(query) || 24, 1 / 12), 8760);
}
import { runPingChecks, getPingServiceStatus, restartPingService, pingHost, testPingHost } from '../services/ping.js';
import { triggerSpeedtest, getSpeedtestServiceStatus, restartSpeedtestService } from '../services/speedtest.js';
import { runDnsChecks, getDnsServiceStatus, restartDnsService } from '../services/dns.js';
import { checkPublicIp, getPublicIpServiceStatus, restartPublicIpService } from '../services/publicip.js';
import { events, EVENT_PING_COMPLETE, EVENT_SPEEDTEST_COMPLETE, EVENT_SPEEDTEST_STARTED, EVENT_SPEEDTEST_PROGRESS, EVENT_DNS_COMPLETE, EVENT_PUBLICIP_CHANGE } from '../events.js';

const router = Router();

// SSE endpoint for real-time updates
const sseClients = new Set();

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connection message
  res.write('data: {"type":"connected"}\n\n');

  // Add client to set
  sseClients.add(res);

  // Remove client on disconnect
  req.on('close', () => {
    sseClients.delete(res);
  });
});

function broadcastEvent(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  sseClients.forEach(client => {
    client.write(`data: ${message}\n\n`);
  });
}

// Listen for events from services
events.on(EVENT_PING_COMPLETE, (results) => {
  broadcastEvent('ping', results);
});

events.on(EVENT_SPEEDTEST_STARTED, () => {
  broadcastEvent('speedtest_started', null);
});

events.on(EVENT_SPEEDTEST_PROGRESS, (progress) => {
  broadcastEvent('speedtest_progress', progress);
});

events.on(EVENT_SPEEDTEST_COMPLETE, (result) => {
  broadcastEvent('speedtest', result);
});

events.on(EVENT_DNS_COMPLETE, (results) => {
  broadcastEvent('dns', results);
});

events.on(EVENT_PUBLICIP_CHANGE, (data) => {
  broadcastEvent('publicip_change', data);
});

// Status endpoint
router.get('/status', (req, res) => {
  const pingStatus = getPingServiceStatus();
  const speedtestStatus = getSpeedtestServiceStatus();
  const dnsStatus = getDnsServiceStatus();
  const publicIpStatus = getPublicIpServiceStatus();
  const stats = db.getStats();

  res.json({
    ping: pingStatus,
    speedtest: speedtestStatus,
    dns: dnsStatus,
    publicIp: publicIpStatus,
    stats
  });
});

const VALID_CONFIG_KEYS = new Set([
  'ping_interval_seconds',
  'speedtest_interval_minutes',
  'data_retention_days',
  'dns_interval_seconds',
  'dns_domains',
  'publicip_interval_minutes',
  'locale',
]);

// Config endpoints
router.get('/config', (req, res) => {
  res.json(db.getAllConfig());
});

router.put('/config', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'Key and value are required' });
  }
  if (!VALID_CONFIG_KEYS.has(key)) {
    return res.status(400).json({ error: `Invalid config key: ${key}` });
  }
  db.setConfig(key, String(value));

  // Restart services if interval changed
  if (key === 'ping_interval_seconds') {
    restartPingService();
  } else if (key === 'speedtest_interval_minutes') {
    restartSpeedtestService();
  } else if (key === 'dns_interval_seconds' || key === 'dns_domains') {
    restartDnsService();
  } else if (key === 'publicip_interval_minutes') {
    restartPublicIpService();
  }

  res.json({ success: true });
});

// Ping target endpoints
router.get('/targets', (req, res) => {
  res.json(db.getPingTargets());
});

router.post('/targets', (req, res) => {
  const { name, host } = req.body;
  if (!name || !host) {
    return res.status(400).json({ error: 'Name and host are required' });
  }
  const existing = db.getPingTargets().find(t => t.host === host);
  if (existing) {
    return res.status(409).json({ error: `A target with host "${host}" already exists` });
  }
  const id = db.addPingTarget(name, host);
  res.json({ id, name, host, enabled: 1 });
});

router.put('/targets/:id', (req, res) => {
  const { id } = req.params;
  const { name, host, enabled } = req.body;
  if (!name || !host) {
    return res.status(400).json({ error: 'Name and host are required' });
  }
  db.updatePingTarget(parseInt(id), name, host, enabled ? 1 : 0);
  res.json({ success: true });
});

router.delete('/targets/:id', (req, res) => {
  const { id } = req.params;
  db.deletePingTarget(parseInt(id));
  res.json({ success: true });
});

// Ping test endpoint (manual) — uses single-shot ping for fast UI response
router.post('/ping/test', async (req, res) => {
  const { host } = req.body;
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }
  const result = await testPingHost(host);
  res.json(result);
});

// Ping results endpoints
router.get('/ping/results', (req, res) => {
  const hours = parseFloat(req.query.hours) || 24;
  const minutes = Math.round(hours * 60);
  res.json(db.getAllPingResults(minutes));
});

router.get('/ping/results/:targetId', (req, res) => {
  const { targetId } = req.params;
  const hours = parseFloat(req.query.hours) || 24;
  const minutes = Math.round(hours * 60);
  res.json(db.getPingResults(parseInt(targetId), minutes));
});

router.get('/ping/latest', (req, res) => {
  res.json(db.getLatestPingResults());
});

router.post('/ping/run', async (req, res) => {
  const results = await runPingChecks();
  res.json(results);
});

// Speedtest endpoints
router.get('/speedtest/results', (req, res) => {
  const hours = parseInt(req.query.hours) || 168; // Default 1 week
  res.json(db.getSpeedtestResults(hours));
});

router.get('/speedtest/latest', (req, res) => {
  const result = db.getLatestSpeedtest();
  res.json(result || null);
});

router.post('/speedtest/run', (req, res) => {
  if (!rateLimit('speedtest', 3, 60000)) {
    return res.status(429).json({ error: 'Rate limit exceeded — max 3 speedtests per minute' });
  }
  const result = triggerSpeedtest();
  res.json(result);
});

// Dashboard status — fast, no large ping data sets
router.get('/dashboard', (req, res) => {
  const hours = parseHours(req.query.hours);
  const minutes = Math.round(hours * 60);

  const latestPings = db.getLatestPingResults();
  const latestSpeedtest = db.getLatestSpeedtest();
  const targets = db.getPingTargets();

  // Uptime / latency via SQL aggregate — fast regardless of data volume
  const uptimeStats = db.getUptimeStats(minutes);
  const uptimeByTarget = {};
  const avgLatencyByTarget = {};
  uptimeStats.forEach(row => {
    uptimeByTarget[row.target_id] = row.total > 0 ? (row.alive_count / row.total * 100) : 0;
    avgLatencyByTarget[row.target_id] = row.avg_latency ?? null;
  });

  // Last 7 days of speedtest results for the chart (capped)
  const speedtestResults = db.getSpeedtestResults(168).slice(0, SPEEDTEST_CHART_LIMIT);

  // DNS data
  const latestDns = db.getLatestDnsResults();
  const successfulDns = latestDns.filter(d => d.success);
  const avgDnsTime = successfulDns.length > 0
    ? successfulDns.reduce((sum, d) => sum + d.time_ms, 0) / successfulDns.length
    : null;

  // Public IP — window matches the selected time range (min 1 day)
  const ipWindowDays = Math.max(1, Math.ceil(hours / 24));
  const latestPublicIp = db.getLatestPublicIp();
  const publicIpHistory = db.getPublicIpHistory(ipWindowDays);

  res.json({
    latestPings,
    latestSpeedtest,
    targets,
    uptimeByTarget,
    avgLatencyByTarget,
    speedtestResults,
    latestDns,
    avgDnsTime,
    latestPublicIp,
    publicIpChanges: Math.max(0, publicIpHistory.length - 1)
  });
});

// Ping chart data — downsampled, may be slightly slower for large ranges but always bounded
router.get('/dashboard/ping-chart', (req, res) => {
  const hours = parseHours(req.query.hours);
  const minutes = Math.round(hours * 60);
  const pingResults = db.getAllPingResultsDownsampled(minutes);
  res.json({ pingResults });
});

// DNS endpoints
router.get('/dns/results', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(db.getDnsResults(hours));
});

router.get('/dns/latest', (req, res) => {
  res.json(db.getLatestDnsResults());
});

router.post('/dns/run', async (req, res) => {
  const results = await runDnsChecks();
  res.json(results || []);
});

// Public IP endpoints
router.get('/publicip/current', (req, res) => {
  const latest = db.getLatestPublicIp();
  const status = getPublicIpServiceStatus();
  res.json({
    ip: latest?.ip_address || status.lastKnownIp || null,
    provider: latest?.provider || null,
    timestamp: latest?.timestamp || null
  });
});

router.get('/publicip/history', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(db.getPublicIpHistory(days));
});

router.post('/publicip/check', async (req, res) => {
  const result = await checkPublicIp();
  res.json(result || { error: 'Failed to check public IP' });
});

// Reports endpoint
router.get('/reports', (req, res) => {
  const period = req.query.period || '7d';
  let days = 7;

  if (period === '24h') days = 1;
  else if (period === '7d') days = 7;
  else if (period === '30d') days = 30;
  else if (period === '90d') days = 90;

  const reportData = db.getReportData(days);
  res.json({ period, days, ...reportData });
});

// Cleanup endpoint (manual trigger) — returns deleted row count
router.post('/cleanup', (req, res) => {
  if (!rateLimit('cleanup', 2, 60000)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const result = db.cleanupOldData();
  res.json({ success: true, ...result });
});

export default router;
