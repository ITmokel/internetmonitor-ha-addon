import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { saveSpeedtestResult, getConfig } from '../database.js';
import { events, EVENT_SPEEDTEST_COMPLETE, EVENT_SPEEDTEST_STARTED, EVENT_SPEEDTEST_PROGRESS } from '../events.js';

const execFileAsync = promisify(execFile);

let isRunning = false;
let intervalId = null;
let lastResult = null;
let lastError = null;

// Run Ookla speedtest with progress streaming
function runOoklaWithProgress() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const args = [
      '--format=json',
      '--progress=yes',
      '--accept-license',
      '--accept-gdpr'
    ];

    const proc = spawn('speedtest', args, { timeout: 120000 });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());

      for (const line of lines) {
        stdout = line; // Keep last complete line

        try {
          const json = JSON.parse(line);

          // Emit progress events
          if (json.type === 'ping') {
            events.emit(EVENT_SPEEDTEST_PROGRESS, {
              phase: 'ping',
              ping: json.ping?.latency || 0,
              jitter: json.ping?.jitter || 0,
            });
          } else if (json.type === 'download') {
            const downloadMbps = (json.download?.bandwidth || 0) / 125000;
            events.emit(EVENT_SPEEDTEST_PROGRESS, {
              phase: 'download',
              download: downloadMbps,
              progress: json.download?.progress || 0,
            });
          } else if (json.type === 'upload') {
            const uploadMbps = (json.upload?.bandwidth || 0) / 125000;
            events.emit(EVENT_SPEEDTEST_PROGRESS, {
              phase: 'upload',
              upload: uploadMbps,
              progress: json.upload?.progress || 0,
            });
          } else if (json.type === 'result') {
            clearTimeout(timer);
            settle(resolve, {
              download: json.download.bandwidth / 125000,
              upload: json.upload.bandwidth / 125000,
              ping: json.ping.latency,
              jitter: json.ping.jitter || 0,
              serverName: json.server.name,
              serverLocation: `${json.server.location}, ${json.server.country}`
            });
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(reject, err.code === 'ENOENT'
        ? new Error('Ookla speedtest CLI not found')
        : err);
    });

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0 && !stdout) {
        settle(reject, new Error(`Speedtest exited with code ${code}: ${stderr}`));
      } else {
        settle(reject, new Error('Speedtest completed without a result JSON'));
      }
    });

    // Timeout
    const timer = setTimeout(() => {
      proc.kill();
      settle(reject, new Error('Speedtest timeout'));
    }, 120000);
  });
}

async function tryPythonSpeedtest() {
  // Python speedtest-cli doesn't support real progress, simulate phases
  events.emit(EVENT_SPEEDTEST_PROGRESS, { phase: 'connecting', message: 'Finding best server...' });

  // Simulate progress phases since Python CLI doesn't support streaming
  const progressInterval = setInterval(() => {
    events.emit(EVENT_SPEEDTEST_PROGRESS, { phase: 'testing', message: 'Running speed test...' });
  }, 3000);

  try {
    const { stdout } = await execFileAsync('speedtest-cli', ['--json'], { timeout: 120000 });
    clearInterval(progressInterval);
    const result = JSON.parse(stdout);

    return {
      download: result.download / 1000000,
      upload: result.upload / 1000000,
      ping: result.ping,
      jitter: 0,
      serverName: result.server.sponsor,
      serverLocation: `${result.server.name}, ${result.server.country}`
    };
  } catch (error) {
    clearInterval(progressInterval);
    throw error;
  }
}

async function tryPythonSpeedtestAlt() {
  // Python speedtest doesn't support real progress, simulate phases
  events.emit(EVENT_SPEEDTEST_PROGRESS, { phase: 'connecting', message: 'Finding best server...' });

  const progressInterval = setInterval(() => {
    events.emit(EVENT_SPEEDTEST_PROGRESS, { phase: 'testing', message: 'Running speed test...' });
  }, 3000);

  try {
    const { stdout } = await execFileAsync('speedtest', ['--json'], { timeout: 120000 });
    clearInterval(progressInterval);
    const result = JSON.parse(stdout);

    return {
      download: result.download / 1000000,
      upload: result.upload / 1000000,
      ping: result.ping,
      jitter: 0,
      serverName: result.server.sponsor,
      serverLocation: `${result.server.name}, ${result.server.country}`
    };
  } catch (error) {
    clearInterval(progressInterval);
    throw error;
  }
}

async function runSpeedtestCLI() {
  // Emit initial progress
  events.emit(EVENT_SPEEDTEST_PROGRESS, { phase: 'connecting', message: 'Initializing...' });

  // Try Ookla first (supports progress)
  try {
    console.log('  Trying Ookla CLI with progress...');
    return await runOoklaWithProgress();
  } catch (error) {
    console.log(`  Ookla failed: ${error.message}`);
  }

  // Fallback to Python versions
  const fallbacks = [
    { name: 'Python speedtest-cli', fn: tryPythonSpeedtest },
    { name: 'Python speedtest', fn: tryPythonSpeedtestAlt }
  ];

  for (const method of fallbacks) {
    try {
      console.log(`  Trying ${method.name}...`);
      return await method.fn();
    } catch (error) {
      console.log(`  ${method.name} failed: ${error.message}`);
    }
  }

  throw new Error(`No speedtest CLI available. Install one of:\n` +
    `  - Ookla CLI: brew install speedtest (macOS) or see https://www.speedtest.net/apps/cli\n` +
    `  - Python CLI: pip install speedtest-cli`);
}

export async function runSpeedtest() {
  if (isRunning) {
    console.log('Speedtest already running, skipping...');
    return null;
  }

  isRunning = true;
  lastError = null;
  console.log('Running speedtest...');
  events.emit(EVENT_SPEEDTEST_STARTED);

  try {
    const data = await runSpeedtestCLI();

    saveSpeedtestResult(
      data.download,
      data.upload,
      data.ping,
      data.jitter,
      data.serverName,
      data.serverLocation
    );

    lastResult = {
      ...data,
      timestamp: new Date().toISOString()
    };

    console.log(`Speedtest complete: ${data.download.toFixed(2)} Mbps down, ${data.upload.toFixed(2)} Mbps up, ${data.ping.toFixed(0)}ms ping`);

    isRunning = false;
    events.emit(EVENT_SPEEDTEST_COMPLETE, lastResult);
    return lastResult;
  } catch (error) {
    console.error('Speedtest error:', error.message);
    lastError = error.message;
    isRunning = false;
    events.emit(EVENT_SPEEDTEST_COMPLETE, null);
    return null;
  }
}

export function startSpeedtestService() {
  const intervalMinutes = parseInt(getConfig('speedtest_interval_minutes')) || 60;

  console.log(`Starting speedtest service with ${intervalMinutes} minute interval`);

  // Run after a short delay to let the server start
  setTimeout(runSpeedtest, 10000);

  // Then run on interval
  intervalId = setInterval(runSpeedtest, intervalMinutes * 60 * 1000);
}

export function stopSpeedtestService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function restartSpeedtestService() {
  stopSpeedtestService();
  startSpeedtestService();
}

export function getSpeedtestServiceStatus() {
  return {
    running: intervalId !== null,
    testing: isRunning,
    lastResult,
    lastError
  };
}

export function triggerSpeedtest() {
  if (isRunning) {
    return { success: false, message: 'Speedtest already in progress' };
  }
  runSpeedtest();
  return { success: true, message: 'Speedtest started' };
}
