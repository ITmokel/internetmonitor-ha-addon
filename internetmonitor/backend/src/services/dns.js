import dns from 'dns';
import { promisify } from 'util';
import { saveDnsResult, getConfig } from '../database.js';
import { events, EVENT_DNS_COMPLETE } from '../events.js';
import { getSpeedtestServiceStatus } from './speedtest.js';

const dnsLookup = promisify(dns.lookup);

let isRunning = false;
let intervalId = null;

// Get system DNS resolver
function getSystemResolver() {
  const servers = dns.getServers();
  return servers.length > 0 ? servers[0] : 'system';
}

// Perform DNS lookup for a single domain
async function lookupDomain(domain) {
  const startTime = performance.now();
  const resolver = getSystemResolver();

  try {
    await dnsLookup(domain);
    const timeMs = performance.now() - startTime;

    return {
      domain,
      resolver,
      timeMs: Math.round(timeMs * 100) / 100,
      success: true,
      error: null
    };
  } catch (error) {
    return {
      domain,
      resolver,
      timeMs: null,
      success: false,
      error: error.code || error.message
    };
  }
}

export async function runDnsChecks() {
  if (isRunning) {
    console.log('DNS checks already running, skipping...');
    return;
  }

  // Skip DNS checks while speedtest is running
  const speedtestStatus = getSpeedtestServiceStatus();
  if (speedtestStatus.testing) {
    console.log('Speedtest in progress, skipping DNS checks...');
    return;
  }

  isRunning = true;

  const domainsStr = getConfig('dns_domains') || 'google.com,cloudflare.com,amazon.com';
  const domains = domainsStr.split(',').map(d => d.trim()).filter(d => d);

  console.log(`Running DNS lookups for ${domains.length} domains...`);

  const results = [];
  for (const domain of domains) {
    // Check again before each lookup in case speedtest started
    const currentSpeedtestStatus = getSpeedtestServiceStatus();
    if (currentSpeedtestStatus.testing) {
      console.log('Speedtest started, aborting DNS checks...');
      isRunning = false;
      return results;
    }

    const result = await lookupDomain(domain);
    saveDnsResult(result.domain, result.resolver, result.timeMs, result.success, result.error);
    results.push(result);

    console.log(`  ${domain}: ${result.success ? `${result.timeMs}ms` : `FAILED (${result.error})`}`);
  }

  isRunning = false;
  events.emit(EVENT_DNS_COMPLETE, results);
  return results;
}

export function startDnsService() {
  const intervalSeconds = parseInt(getConfig('dns_interval_seconds')) || 60;

  console.log(`Starting DNS service with ${intervalSeconds}s interval`);

  // Run immediately
  runDnsChecks();

  // Then run on interval
  intervalId = setInterval(runDnsChecks, intervalSeconds * 1000);
}

export function stopDnsService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function restartDnsService() {
  stopDnsService();
  startDnsService();
}

export function getDnsServiceStatus() {
  return {
    running: intervalId !== null,
    checking: isRunning
  };
}
