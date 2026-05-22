import Database from 'better-sqlite3';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const dbPath = path.join(DATA_DIR, 'internetmonitor.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ping_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ping_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    alive INTEGER NOT NULL,
    time_ms REAL,
    packet_loss REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (target_id) REFERENCES ping_targets(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ping_results_batch ON ping_results(batch_id);

  CREATE TABLE IF NOT EXISTS speedtest_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    download_mbps REAL,
    upload_mbps REAL,
    ping_ms REAL,
    jitter_ms REAL,
    server_name TEXT,
    server_location TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_ping_results_timestamp ON ping_results(timestamp);
  CREATE INDEX IF NOT EXISTS idx_ping_results_target ON ping_results(target_id);
  CREATE INDEX IF NOT EXISTS idx_speedtest_timestamp ON speedtest_results(timestamp);

  CREATE TABLE IF NOT EXISTS dns_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    resolver TEXT,
    time_ms REAL,
    success INTEGER NOT NULL,
    error TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_dns_results_timestamp ON dns_results(timestamp);
  CREATE INDEX IF NOT EXISTS idx_dns_results_domain ON dns_results(domain);

  CREATE TABLE IF NOT EXISTS publicip_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    provider TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_publicip_timestamp ON publicip_history(timestamp);
`);

// Insert default config if not exists (web UI is the primary way to configure)
const defaultConfig = {
  ping_interval_seconds: '60',
  speedtest_interval_minutes: '60',
  data_retention_days: '365',
  dns_interval_seconds: '60',
  dns_domains: 'google.com,cloudflare.com,amazon.com',
  publicip_interval_minutes: '15',
  locale: 'en',
};

const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultConfig)) {
  insertConfig.run(key, value);
}

// Insert default ping targets if none exist
const targetCount = db.prepare('SELECT COUNT(*) as count FROM ping_targets').get();
if (targetCount.count === 0) {
  const defaultTargets = [
    { name: 'Google DNS', host: '8.8.8.8' },
    { name: 'Cloudflare DNS', host: '1.1.1.1' },
    { name: 'Example.com', host: 'example.com' }
  ];
  const insertTarget = db.prepare('INSERT INTO ping_targets (name, host) VALUES (?, ?)');
  for (const target of defaultTargets) {
    insertTarget.run(target.name, target.host);
  }
}

// Config functions
export function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setConfig(key, value) {
  db.prepare('UPDATE config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(value, key);
}

export function getAllConfig() {
  return db.prepare('SELECT key, value FROM config').all().reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

// Ping target functions
export function getPingTargets() {
  return db.prepare('SELECT * FROM ping_targets ORDER BY id').all();
}

export function addPingTarget(name, host) {
  const result = db.prepare('INSERT INTO ping_targets (name, host) VALUES (?, ?)').run(name, host);
  return result.lastInsertRowid;
}

export function updatePingTarget(id, name, host, enabled) {
  db.prepare('UPDATE ping_targets SET name = ?, host = ?, enabled = ? WHERE id = ?').run(name, host, enabled, id);
}

export function deletePingTarget(id) {
  db.prepare('DELETE FROM ping_targets WHERE id = ?').run(id);
}

// Ping result functions
export function getNextBatchId() {
  const result = db.prepare('SELECT MAX(batch_id) as max_batch FROM ping_results').get();
  return (result.max_batch || 0) + 1;
}

export function savePingResult(targetId, batchId, alive, timeMs, packetLoss) {
  db.prepare('INSERT INTO ping_results (target_id, batch_id, alive, time_ms, packet_loss) VALUES (?, ?, ?, ?, ?)').run(targetId, batchId, alive ? 1 : 0, timeMs, packetLoss);
}

export function getPingResults(targetId, minutes = 1440) {
  return db.prepare(`
    SELECT pr.*, pt.name as target_name, pt.host as target_host
    FROM ping_results pr
    JOIN ping_targets pt ON pr.target_id = pt.id
    WHERE pr.target_id = ? AND pr.timestamp > datetime('now', '-' || ? || ' minutes')
    ORDER BY pr.timestamp DESC
  `).all(targetId, minutes);
}

export function getAllPingResults(minutes = 1440) {
  return db.prepare(`
    SELECT pr.*, pt.name as target_name, pt.host as target_host
    FROM ping_results pr
    JOIN ping_targets pt ON pr.target_id = pt.id
    WHERE pr.timestamp > datetime('now', '-' || ? || ' minutes')
    ORDER BY pr.timestamp DESC
  `).all(minutes);
}

// Returns time-bucketed ping results capped at maxBatches per target — fast even for 7d+
export function getAllPingResultsDownsampled(minutes, maxBatches = 800) {
  const bucketSeconds = minutes <= 360
    ? 60
    : Math.ceil((minutes * 60) / maxBatches);

  if (bucketSeconds <= 60) {
    return getAllPingResults(minutes);
  }

  return db.prepare(`
    SELECT
      pr.target_id,
      CAST(strftime('%s', pr.timestamp) AS INTEGER) / ? AS batch_id,
      MAX(pr.alive) AS alive,
      ROUND(AVG(CASE WHEN pr.alive = 1 THEN pr.time_ms END), 2) AS time_ms,
      datetime(
        (CAST(strftime('%s', pr.timestamp) AS INTEGER) / ?) * ?,
        'unixepoch'
      ) AS timestamp,
      pt.name AS target_name,
      pt.host AS target_host
    FROM ping_results pr
    JOIN ping_targets pt ON pr.target_id = pt.id
    WHERE pr.timestamp > datetime('now', '-' || ? || ' minutes')
    GROUP BY pr.target_id, CAST(strftime('%s', pr.timestamp) AS INTEGER) / ?
    ORDER BY timestamp ASC
  `).all(bucketSeconds, bucketSeconds, bucketSeconds, minutes, bucketSeconds);
}

// SQL-aggregate uptime/latency per target — fast regardless of data volume
export function getUptimeStats(minutes) {
  return db.prepare(`
    SELECT
      target_id,
      COUNT(*) AS total,
      SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) AS alive_count,
      AVG(CASE WHEN alive = 1 THEN time_ms END) AS avg_latency
    FROM ping_results
    WHERE timestamp > datetime('now', '-' || ? || ' minutes')
    GROUP BY target_id
  `).all(minutes);
}

export function getLatestPingResults() {
  return db.prepare(`
    SELECT pr.*, pt.name as target_name, pt.host as target_host
    FROM ping_results pr
    JOIN ping_targets pt ON pr.target_id = pt.id
    WHERE pr.id IN (
      SELECT MAX(id) FROM ping_results GROUP BY target_id
    )
  `).all();
}

// Speedtest result functions
export function saveSpeedtestResult(download, upload, ping, jitter, serverName, serverLocation) {
  db.prepare(`
    INSERT INTO speedtest_results (download_mbps, upload_mbps, ping_ms, jitter_ms, server_name, server_location)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(download, upload, ping, jitter, serverName, serverLocation);
}

export function getSpeedtestResults(hours = 168) {
  return db.prepare(`
    SELECT * FROM speedtest_results
    WHERE timestamp > datetime('now', '-' || ? || ' hours')
    ORDER BY timestamp DESC
  `).all(hours);
}

export function getLatestSpeedtest() {
  return db.prepare('SELECT * FROM speedtest_results ORDER BY timestamp DESC LIMIT 1').get();
}

// DNS result functions
export function saveDnsResult(domain, resolver, timeMs, success, error = null) {
  db.prepare(`
    INSERT INTO dns_results (domain, resolver, time_ms, success, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(domain, resolver, timeMs, success ? 1 : 0, error);
}

export function getDnsResults(hours = 24) {
  return db.prepare(`
    SELECT * FROM dns_results
    WHERE timestamp > datetime('now', '-' || ? || ' hours')
    ORDER BY timestamp DESC
  `).all(hours);
}

export function getLatestDnsResults() {
  return db.prepare(`
    SELECT * FROM dns_results
    WHERE id IN (
      SELECT MAX(id) FROM dns_results GROUP BY domain
    )
  `).all();
}

// Public IP functions
export function savePublicIp(ipAddress, provider) {
  // Only save if IP changed from the last entry
  const latest = getLatestPublicIp();
  if (latest && latest.ip_address === ipAddress) {
    return false; // No change
  }
  db.prepare(`
    INSERT INTO publicip_history (ip_address, provider)
    VALUES (?, ?)
  `).run(ipAddress, provider);
  return true; // IP changed
}

export function getLatestPublicIp() {
  return db.prepare('SELECT * FROM publicip_history ORDER BY timestamp DESC LIMIT 1').get();
}

export function getPublicIpHistory(days = 30) {
  return db.prepare(`
    SELECT * FROM publicip_history
    WHERE timestamp > datetime('now', '-' || ? || ' days')
    ORDER BY timestamp DESC
  `).all(days);
}

// Report data aggregation
export function getReportData(days) {
  const result = {};

  // Ping stats
  const pingStats = db.prepare(`
    SELECT
      COUNT(*) as total_checks,
      SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) as successful_pings,
      AVG(CASE WHEN alive = 1 THEN time_ms END) as avg_latency,
      MIN(CASE WHEN alive = 1 THEN time_ms END) as min_latency,
      MAX(CASE WHEN alive = 1 THEN time_ms END) as max_latency
    FROM ping_results
    WHERE timestamp > datetime('now', '-' || ? || ' days')
  `).get(days);

  result.ping = {
    totalChecks: pingStats.total_checks || 0,
    successfulPings: pingStats.successful_pings || 0,
    uptimePercent: pingStats.total_checks > 0 ? (pingStats.successful_pings / pingStats.total_checks * 100) : 0,
    avgLatency: pingStats.avg_latency,
    minLatency: pingStats.min_latency,
    maxLatency: pingStats.max_latency
  };

  // Speedtest stats
  const speedtestStats = db.prepare(`
    SELECT
      COUNT(*) as total_tests,
      AVG(download_mbps) as avg_download,
      MIN(download_mbps) as min_download,
      MAX(download_mbps) as max_download,
      AVG(upload_mbps) as avg_upload,
      MIN(upload_mbps) as min_upload,
      MAX(upload_mbps) as max_upload,
      AVG(ping_ms) as avg_ping,
      AVG(jitter_ms) as avg_jitter
    FROM speedtest_results
    WHERE timestamp > datetime('now', '-' || ? || ' days')
  `).get(days);

  result.speedtest = {
    totalTests: speedtestStats.total_tests || 0,
    avgDownload: speedtestStats.avg_download,
    minDownload: speedtestStats.min_download,
    maxDownload: speedtestStats.max_download,
    avgUpload: speedtestStats.avg_upload,
    minUpload: speedtestStats.min_upload,
    maxUpload: speedtestStats.max_upload,
    avgPing: speedtestStats.avg_ping,
    avgJitter: speedtestStats.avg_jitter
  };

  // DNS stats
  const dnsStats = db.prepare(`
    SELECT
      COUNT(*) as total_lookups,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_lookups,
      AVG(CASE WHEN success = 1 THEN time_ms END) as avg_time,
      MIN(CASE WHEN success = 1 THEN time_ms END) as min_time,
      MAX(CASE WHEN success = 1 THEN time_ms END) as max_time
    FROM dns_results
    WHERE timestamp > datetime('now', '-' || ? || ' days')
  `).get(days);

  result.dns = {
    totalLookups: dnsStats.total_lookups || 0,
    successfulLookups: dnsStats.successful_lookups || 0,
    successRate: dnsStats.total_lookups > 0 ? (dnsStats.successful_lookups / dnsStats.total_lookups * 100) : 0,
    avgTime: dnsStats.avg_time,
    minTime: dnsStats.min_time,
    maxTime: dnsStats.max_time
  };

  // Public IP changes count
  const ipChanges = db.prepare(`
    SELECT COUNT(*) as changes
    FROM publicip_history
    WHERE timestamp > datetime('now', '-' || ? || ' days')
  `).get(days);

  result.publicIp = {
    changes: Math.max(0, (ipChanges.changes || 0) - 1) // Subtract 1 because first entry isn't a "change"
  };

  // Daily breakdown for charts
  result.dailyStats = db.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(*) as ping_checks,
      SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) as successful_pings,
      AVG(CASE WHEN alive = 1 THEN time_ms END) as avg_latency
    FROM ping_results
    WHERE timestamp > datetime('now', '-' || ? || ' days')
    GROUP BY date(timestamp)
    ORDER BY date
  `).all(days);

  // Daily speedtest stats
  result.dailySpeedtest = db.prepare(`
    SELECT
      date(timestamp) as date,
      AVG(download_mbps) as avg_download,
      AVG(upload_mbps) as avg_upload
    FROM speedtest_results
    WHERE timestamp > datetime('now', '-' || ? || ' days')
    GROUP BY date(timestamp)
    ORDER BY date
  `).all(days);

  // Worst days by uptime
  result.worstDays = db.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(*) as total_checks,
      SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) as successful_pings,
      CAST(SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 as uptime_percent
    FROM ping_results
    WHERE timestamp > datetime('now', '-' || ? || ' days')
    GROUP BY date(timestamp)
    HAVING COUNT(*) > 10
    ORDER BY uptime_percent ASC
    LIMIT 5
  `).all(days);

  // Outage periods (consecutive failed pings)
  result.outages = db.prepare(`
    SELECT
      MIN(timestamp) as start_time,
      MAX(timestamp) as end_time,
      COUNT(*) as failed_checks,
      batch_id as start_batch
    FROM (
      SELECT *,
        batch_id - ROW_NUMBER() OVER (ORDER BY batch_id) as grp
      FROM ping_results
      WHERE alive = 0 AND timestamp > datetime('now', '-' || ? || ' days')
    )
    GROUP BY grp
    HAVING COUNT(*) >= 2
    ORDER BY start_time DESC
    LIMIT 10
  `).all(days);

  return result;
}

// Cleanup old data — returns total deleted row count and applied retention window
export function cleanupOldData() {
  const retentionDays = parseInt(getConfig('data_retention_days')) || 365;
  const ping     = db.prepare(`DELETE FROM ping_results      WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
  const speedtest= db.prepare(`DELETE FROM speedtest_results WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
  const dns      = db.prepare(`DELETE FROM dns_results       WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
  const publicip = db.prepare(`DELETE FROM publicip_history  WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
  return {
    deleted: ping.changes + speedtest.changes + dns.changes + publicip.changes,
    retentionDays,
  };
}

// Statistics
export function getStats() {
  const pingCount = db.prepare('SELECT COUNT(*) as count FROM ping_results').get().count;
  const speedtestCount = db.prepare('SELECT COUNT(*) as count FROM speedtest_results').get().count;
  const oldestPing = db.prepare('SELECT MIN(timestamp) as oldest FROM ping_results').get().oldest;
  const oldestSpeedtest = db.prepare('SELECT MIN(timestamp) as oldest FROM speedtest_results').get().oldest;

  return {
    pingCount,
    speedtestCount,
    oldestPing,
    oldestSpeedtest
  };
}

export default db;
