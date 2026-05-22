import ping from 'ping';
import { getPingTargets, savePingResult, getConfig, getNextBatchId } from '../database.js';
import { events, EVENT_PING_COMPLETE } from '../events.js';
import { getSpeedtestServiceStatus } from './speedtest.js';

let isRunning = false;
let intervalId = null;

export async function pingHost(host) {
  try {
    const result = await ping.promise.probe(host, {
      timeout: 10,
      extra: ['-c', '3']
    });
    return {
      alive: result.alive,
      time: result.alive ? parseFloat(result.avg) : null,
      packetLoss: parseFloat(result.packetLoss) || 0
    };
  } catch (error) {
    console.error(`Ping error for ${host}:`, error.message);
    return { alive: false, time: null, packetLoss: 100 };
  }
}

// Single-shot test ping — faster response for the UI "Test" button
export async function testPingHost(host) {
  try {
    const result = await ping.promise.probe(host, {
      timeout: 5,
      extra: ['-c', '1']
    });
    return {
      alive: result.alive,
      time: result.alive ? parseFloat(result.avg) : null,
      packetLoss: parseFloat(result.packetLoss) || 0
    };
  } catch (error) {
    console.error(`Ping test error for ${host}:`, error.message);
    return { alive: false, time: null, packetLoss: 100 };
  }
}

export async function runPingChecks() {
  if (isRunning) {
    console.log('Ping checks already running, skipping...');
    return;
  }

  // Skip ping checks while speedtest is running to avoid skewed latency data
  const speedtestStatus = getSpeedtestServiceStatus();
  if (speedtestStatus.testing) {
    console.log('Speedtest in progress, skipping ping checks...');
    return;
  }

  isRunning = true;
  const targets = getPingTargets().filter(t => t.enabled);
  const batchId = getNextBatchId();

  console.log(`Running ping checks for ${targets.length} targets (batch ${batchId})...`);

  const results = [];
  for (const target of targets) {
    // Check again before each ping in case speedtest started mid-batch
    const currentSpeedtestStatus = getSpeedtestServiceStatus();
    if (currentSpeedtestStatus.testing) {
      console.log('Speedtest started mid-batch, aborting ping checks...');
      isRunning = false;
      return results;
    }

    const result = await pingHost(target.host);

    // Check one more time before saving - don't save if speedtest started during this ping
    const statusBeforeSave = getSpeedtestServiceStatus();
    if (statusBeforeSave.testing) {
      console.log('Speedtest started during ping, discarding results...');
      isRunning = false;
      return results;
    }

    savePingResult(target.id, batchId, result.alive, result.time, result.packetLoss);
    results.push({
      target,
      batchId,
      ...result
    });
    console.log(`  ${target.name} (${target.host}): ${result.alive ? `${result.time}ms` : 'OFFLINE'}`);
  }

  isRunning = false;
  events.emit(EVENT_PING_COMPLETE, results);
  return results;
}

export function startPingService() {
  const intervalSeconds = parseInt(getConfig('ping_interval_seconds')) || 60;

  console.log(`Starting ping service with ${intervalSeconds}s interval`);

  // Run immediately
  runPingChecks();

  // Then run on interval
  intervalId = setInterval(runPingChecks, intervalSeconds * 1000);
}

export function stopPingService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function restartPingService() {
  stopPingService();
  startPingService();
}

export function getPingServiceStatus() {
  return {
    running: intervalId !== null,
    checking: isRunning
  };
}
