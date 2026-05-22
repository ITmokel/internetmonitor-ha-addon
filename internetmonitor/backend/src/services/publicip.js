import { savePublicIp, getConfig, getLatestPublicIp } from '../database.js';
import { events, EVENT_PUBLICIP_CHANGE } from '../events.js';

let isRunning = false;
let intervalId = null;
let lastKnownIp = null;

// IP lookup services with fallbacks
const IP_SERVICES = [
  { name: 'ipify', url: 'https://api.ipify.org?format=json', parser: (data) => JSON.parse(data).ip },
  { name: 'ipinfo', url: 'https://ipinfo.io/json', parser: (data) => JSON.parse(data).ip },
  { name: 'ifconfig.me', url: 'https://ifconfig.me/ip', parser: (data) => data.trim() },
];

async function fetchWithTimeout(url, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'InternetMonitor/1.0' }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function getPublicIpFromService(service) {
  try {
    const data = await fetchWithTimeout(service.url);
    const ip = service.parser(data);

    // Validate IP format (basic check)
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !/^[a-f0-9:]+$/i.test(ip)) {
      throw new Error('Invalid IP format');
    }

    return { ip, provider: service.name };
  } catch (error) {
    throw error;
  }
}

export async function checkPublicIp() {
  if (isRunning) {
    console.log('Public IP check already running, skipping...');
    return null;
  }

  isRunning = true;

  // Try each service until one succeeds
  for (const service of IP_SERVICES) {
    try {
      const result = await getPublicIpFromService(service);

      // Save to database (only if changed)
      const ipChanged = savePublicIp(result.ip, result.provider);

      if (ipChanged) {
        console.log(`Public IP changed: ${lastKnownIp || 'unknown'} -> ${result.ip} (via ${result.provider})`);
        lastKnownIp = result.ip;
        events.emit(EVENT_PUBLICIP_CHANGE, { ip: result.ip, provider: result.provider, previousIp: lastKnownIp });
      } else {
        console.log(`Public IP: ${result.ip} (unchanged)`);
      }

      isRunning = false;
      return { ...result, changed: ipChanged };
    } catch (error) {
      console.log(`  ${service.name} failed: ${error.message}`);
    }
  }

  console.error('All public IP services failed');
  isRunning = false;
  return null;
}

export function startPublicIpService() {
  const intervalMinutes = parseInt(getConfig('publicip_interval_minutes')) || 15;

  console.log(`Starting public IP service with ${intervalMinutes} minute interval`);

  // Initialize lastKnownIp from database
  const latest = getLatestPublicIp();
  if (latest) {
    lastKnownIp = latest.ip_address;
    console.log(`  Last known IP: ${lastKnownIp}`);
  }

  // Run immediately
  checkPublicIp();

  // Then run on interval
  intervalId = setInterval(checkPublicIp, intervalMinutes * 60 * 1000);
}

export function stopPublicIpService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function restartPublicIpService() {
  stopPublicIpService();
  startPublicIpService();
}

export function getPublicIpServiceStatus() {
  return {
    running: intervalId !== null,
    checking: isRunning,
    lastKnownIp
  };
}
