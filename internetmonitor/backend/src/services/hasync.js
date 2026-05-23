import * as db from '../database.js';
import { events, EVENT_PING_COMPLETE, EVENT_SPEEDTEST_COMPLETE, EVENT_DNS_COMPLETE, EVENT_PUBLICIP_CHANGE } from '../events.js';

const HA_API = 'http://supervisor/core/api';

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function setState(entityId, state, attributes = {}) {
  const token = process.env.SUPERVISOR_TOKEN;
  try {
    const res = await fetch(`${HA_API}/states/${entityId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: String(state), attributes }),
    });
    if (!res.ok) {
      console.error(`[HA Sync] ${entityId}: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[HA Sync] ${entityId}: ${err.message}`);
  }
}

function safeMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Ping event format: [{ target: { id, name, host }, alive, time, packetLoss }]
// DB format:         [{ target_id, target_name, target_host, alive, time_ms }]
function normalizePingResults(results) {
  return results.map(r => ({
    id:   r.target?.id   ?? r.target_id,
    name: r.target?.name ?? r.target_name,
    host: r.target?.host ?? r.target_host,
    alive: r.alive,
    latency: safeMs(r.time ?? r.time_ms),
  }));
}

async function syncPing(results) {
  const normalized = normalizePingResults(results);
  const uptimeStats = db.getUptimeStats(1440);
  const uptimeMap = Object.fromEntries(uptimeStats.map(s => [s.target_id, s]));

  for (const r of normalized) {
    const slug = slugify(r.name);
    const latency = r.alive && r.latency != null ? r.latency.toFixed(1) : 'unavailable';
    const uptime = uptimeMap[r.id];
    const uptimePct = uptime?.total > 0
      ? (uptime.alive_count / uptime.total * 100).toFixed(1)
      : 'unavailable';

    await setState(`sensor.internetmonitor_ping_${slug}_latency`, latency, {
      friendly_name: `Internet Monitor: ${r.name} Latency`,
      unit_of_measurement: 'ms',
      state_class: 'measurement',
      icon: 'mdi:lan-pending',
      host: r.host,
    });

    await setState(`sensor.internetmonitor_ping_${slug}_status`, r.alive ? 'online' : 'offline', {
      friendly_name: `Internet Monitor: ${r.name} Status`,
      icon: r.alive ? 'mdi:check-network' : 'mdi:network-off',
      host: r.host,
    });

    await setState(`sensor.internetmonitor_ping_${slug}_uptime_24h`, uptimePct, {
      friendly_name: `Internet Monitor: ${r.name} Uptime (24h)`,
      unit_of_measurement: '%',
      state_class: 'measurement',
      icon: 'mdi:percent',
    });
  }
}

// Speedtest event format: { download, upload, ping, jitter, serverName, serverLocation } or null
async function syncSpeedtest(result) {
  if (!result) return;

  await setState('sensor.internetmonitor_download_speed', result.download.toFixed(1), {
    friendly_name: 'Internet Monitor: Download Speed',
    unit_of_measurement: 'Mbit/s',
    device_class: 'data_rate',
    state_class: 'measurement',
    icon: 'mdi:download-network',
    server: result.serverName,
  });

  await setState('sensor.internetmonitor_upload_speed', result.upload.toFixed(1), {
    friendly_name: 'Internet Monitor: Upload Speed',
    unit_of_measurement: 'Mbit/s',
    device_class: 'data_rate',
    state_class: 'measurement',
    icon: 'mdi:upload-network',
    server: result.serverName,
  });

  await setState('sensor.internetmonitor_speedtest_ping', result.ping.toFixed(1), {
    friendly_name: 'Internet Monitor: Speedtest Ping',
    unit_of_measurement: 'ms',
    state_class: 'measurement',
    icon: 'mdi:speedometer',
  });

  await setState('sensor.internetmonitor_speedtest_jitter', result.jitter.toFixed(1), {
    friendly_name: 'Internet Monitor: Speedtest Jitter',
    unit_of_measurement: 'ms',
    state_class: 'measurement',
    icon: 'mdi:chart-bell-curve',
  });
}

// DNS event format: [{ domain, timeMs, success }]  (camelCase from service)
// DB format:        [{ domain, time_ms, success }]  (snake_case from SQLite)
async function syncDns(results) {
  if (!results?.length) return;
  const successful = results.filter(d => d.success);
  const times = successful.map(d => safeMs(d.timeMs ?? d.time_ms)).filter(v => v != null);
  const avg = times.length > 0
    ? (times.reduce((s, v) => s + v, 0) / times.length).toFixed(1)
    : 'unavailable';

  await setState('sensor.internetmonitor_dns_latency', avg, {
    friendly_name: 'Internet Monitor: DNS Latency',
    unit_of_measurement: 'ms',
    state_class: 'measurement',
    icon: 'mdi:dns',
  });
}

// PublicIP event: { ip, provider } | DB row: { ip_address, provider }
async function syncPublicIp(data) {
  const ip = data?.ip ?? data?.ip_address ?? 'unavailable';
  await setState('sensor.internetmonitor_public_ip', ip, {
    friendly_name: 'Internet Monitor: Public IP',
    icon: 'mdi:ip-network',
    provider: data?.provider ?? null,
  });
}

// Speedtest DB row has different field names than the event payload
function dbSpeedtestToEvent(row) {
  if (!row) return null;
  return {
    download: row.download_mbps,
    upload: row.upload_mbps,
    ping: row.ping_ms,
    jitter: row.jitter_ms ?? 0,
    serverName: row.server_name,
    serverLocation: row.server_location,
  };
}

export function startHaSyncService() {
  if (!process.env.SUPERVISOR_TOKEN) {
    console.log('[HA Sync] SUPERVISOR_TOKEN not set — skipping (normal in dev)');
    return;
  }

  console.log('[HA Sync] Starting Home Assistant sensor sync');

  events.on(EVENT_PING_COMPLETE, syncPing);
  events.on(EVENT_SPEEDTEST_COMPLETE, syncSpeedtest);
  events.on(EVENT_DNS_COMPLETE, syncDns);
  events.on(EVENT_PUBLICIP_CHANGE, syncPublicIp);

  // Push current state immediately on startup so sensors appear right away
  const latestPings = db.getLatestPingResults();
  if (latestPings.length) syncPing(latestPings);

  const latestSpeedtest = db.getLatestSpeedtest();
  if (latestSpeedtest) syncSpeedtest(dbSpeedtestToEvent(latestSpeedtest));

  const latestDns = db.getLatestDnsResults();
  if (latestDns.length) syncDns(latestDns);

  const latestIp = db.getLatestPublicIp();
  if (latestIp) syncPublicIp(latestIp);
}
