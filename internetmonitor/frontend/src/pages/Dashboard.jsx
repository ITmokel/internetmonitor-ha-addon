import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { Line } from 'react-chartjs-2';
import api from '../lib/api';
import { CT, PING_COLORS } from '../lib/chartTheme';
import { useLocale } from '../lib/locale';

ChartJS.register(
  CategoryScale, LinearScale, TimeScale,
  PointElement, LineElement,
  Title, Tooltip, Legend, Filler
);

const TIME_RANGES = [
  { value: 5 / 60, label: '5m' },
  { value: 15 / 60, label: '15m' },
  { value: 1, label: '1h' },
  { value: 6, label: '6h' },
  { value: 24, label: '1d' },
  { value: 168, label: '7d' },
];

const SPEEDTEST_TIME_RANGES = [
  { value: 1, label: '1h' },
  { value: 6, label: '6h' },
  { value: 24, label: '1d' },
  { value: 168, label: '7d' },
];

function formatTimeRange(hours) {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (hours === 24) return '24 hours';
  return `${Math.round(hours / 24)} day${hours > 48 ? 's' : ''}`;
}

function parseUTCTimestamp(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z').getTime();
}

const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'top', labels: { color: CT.ticks, usePointStyle: true } },
  },
  scales: {
    x: { grid: { color: CT.grid }, ticks: { color: CT.ticks, maxTicksLimit: 10 } },
    y: { grid: { color: CT.grid }, ticks: { color: CT.ticks } },
  },
};

// Shortest gap that still breaks the line — anything below this is normal jitter
const MIN_SPAN_GAP_MS = 300000;

// The backend downsamples long ranges into time buckets, so the spacing between
// points grows with the selected range (up to ~13 min for 7d). A fixed gap limit
// would break every single segment there and the chart would render empty, so the
// limit is derived from the actual spacing of the data.
function computeSpanGaps(times) {
  if (times.length < 3) return MIN_SPAN_GAP_MS;
  const deltas = [];
  for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
  deltas.sort((a, b) => a - b);
  return Math.max(MIN_SPAN_GAP_MS, deltas[Math.floor(deltas.length / 2)] * 3);
}

function buildPingChartDatasets(pingResults, targets) {
  if (!pingResults?.length || !targets.length) return { datasets: [] };

  const sorted = [...pingResults].sort(
    (a, b) => parseUTCTimestamp(a.timestamp) - parseUTCTimestamp(b.timestamp)
  );

  const batchGroups = {};
  const batchTimestamps = {};
  sorted.forEach(r => {
    if (!batchGroups[r.batch_id]) {
      batchGroups[r.batch_id] = {};
      batchTimestamps[r.batch_id] = r.timestamp;
    }
    batchGroups[r.batch_id][r.target_id] = r.alive && r.time_ms > 0 ? r.time_ms : null;
  });

  const batchIds = Object.keys(batchGroups).map(Number).sort((a, b) => a - b);
  const batchTimes = batchIds.map(id => parseUTCTimestamp(batchTimestamps[id]));
  const spanGaps = computeSpanGaps(batchTimes);

  const datasets = targets.map((target, i) => ({
    label: target.name,
    data: batchIds.map((id, idx) => ({
      x: batchTimes[idx],
      y: batchGroups[id]?.[target.id] ?? null,
    })),
    borderColor: PING_COLORS[i % PING_COLORS.length],
    backgroundColor: PING_COLORS[i % PING_COLORS.length] + '20',
    tension: 0.3,
    fill: false,
    spanGaps,
    pointRadius: 0,
  }));

  const averageData = batchIds.map((id, idx) => {
    const vals = Object.values(batchGroups[id]).filter(v => typeof v === 'number' && v > 0);
    if (!vals.length) return null;
    return {
      x: batchTimes[idx],
      y: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100,
    };
  });

  return {
    datasets: [
      {
        label: 'Average',
        data: averageData,
        borderColor: CT.white,
        backgroundColor: CT.white + '20',
        borderWidth: 2,
        borderDash: [5, 5],
        tension: 0.3,
        fill: false,
        spanGaps,
        pointRadius: 0,
        order: 0,
      },
      ...datasets,
    ],
  };
}

// Safety cap only — the selected time range already bounds the query, this just
// guards against pathological configs (e.g. a 1-minute speedtest interval over 7d).
const SPEEDTEST_CHART_POINT_LIMIT = 500;

function buildSpeedtestChartData(speedtestResults) {
  if (!speedtestResults?.length) return { datasets: [] };
  const items = [...speedtestResults].reverse().slice(-SPEEDTEST_CHART_POINT_LIMIT);
  return {
    datasets: [
      {
        label: 'Download (Mbps)',
        data: items.map(r => ({
          x: parseUTCTimestamp(r.timestamp),
          y: r.download_mbps != null ? parseFloat(r.download_mbps.toFixed(2)) : null,
        })),
        borderColor: CT.success,
        backgroundColor: CT.success + '20',
        tension: 0.3,
        fill: true,
        pointRadius: 0,
      },
      {
        label: 'Upload (Mbps)',
        data: items.map(r => ({
          x: parseUTCTimestamp(r.timestamp),
          y: r.upload_mbps != null ? parseFloat(r.upload_mbps.toFixed(2)) : null,
        })),
        borderColor: CT.blue,
        backgroundColor: CT.blue + '20',
        tension: 0.3,
        fill: true,
        pointRadius: 0,
      },
    ],
  };
}

export default function Dashboard() {
  const { formatDateTime, chartTimeFormats } = useLocale();
  const [loading, setLoading] = useState(true);
  const [pingChartLoading, setPingChartLoading] = useState(true);
  const [speedtestChartLoading, setSpeedtestChartLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(1);
  const [speedtestTimeRange, setSpeedtestTimeRange] = useState(24);
  const [runningSpeedtest, setRunningSpeedtest] = useState(false);
  const [speedtestProgress, setSpeedtestProgress] = useState(null);
  const [showSpeedtestResult, setShowSpeedtestResult] = useState(null);
  const [pingViewMode, setPingViewMode] = useState('all');
  const [refreshingPing, setRefreshingPing] = useState(false);
  const [refreshingDns, setRefreshingDns] = useState(false);

  const [latestPings, setLatestPings] = useState([]);
  const [latestSpeedtest, setLatestSpeedtest] = useState(null);
  const [targets, setTargets] = useState([]);
  const [uptimeByTarget, setUptimeByTarget] = useState({});
  const [avgLatencyByTarget, setAvgLatencyByTarget] = useState({});
  const [latestDns, setLatestDns] = useState([]);
  const [avgDnsTime, setAvgDnsTime] = useState(null);
  const [latestPublicIp, setLatestPublicIp] = useState(null);
  const [publicIpChanges, setPublicIpChanges] = useState(0);

  const [pingChartData, setPingChartData] = useState({ datasets: [] });
  const [speedtestChartData, setSpeedtestChartData] = useState({ datasets: [] });
  const [chartNow, setChartNow] = useState(Date.now());

  const pingChartRef = useRef(null);
  const speedtestChartRef = useRef(null);
  const targetsRef = useRef([]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setPingChartLoading(true);
    try {
      const [status, chart] = await Promise.all([
        api.getDashboard(timeRange),
        api.getDashboardPingChart(timeRange),
      ]);

      setLatestPings(status.latestPings);
      setLatestSpeedtest(status.latestSpeedtest);
      setTargets(status.targets);
      targetsRef.current = status.targets;
      setUptimeByTarget(status.uptimeByTarget);
      setAvgLatencyByTarget(status.avgLatencyByTarget);
      setLatestDns(status.latestDns || []);
      setAvgDnsTime(status.avgDnsTime);
      setLatestPublicIp(status.latestPublicIp);
      setPublicIpChanges(status.publicIpChanges || 0);

      setChartNow(Date.now());
      setPingChartData(buildPingChartDatasets(chart.pingResults, status.targets));
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
      setPingChartLoading(false);
    }
  }, [timeRange]);

  const fetchSpeedtestChart = useCallback(async () => {
    setSpeedtestChartLoading(true);
    try {
      const results = await api.getSpeedtestResults(speedtestTimeRange);
      setChartNow(Date.now());
      setSpeedtestChartData(buildSpeedtestChartData(results));
    } catch (err) {
      console.error('Failed to fetch speedtest chart data:', err);
    } finally {
      setSpeedtestChartLoading(false);
    }
  }, [speedtestTimeRange]);

  const addPingResults = useCallback((results, currentTargets) => {
    if (!results?.length || !currentTargets.length) return;
    const now = Date.now();

    setLatestPings(results.map(r => ({
      target_id: r.target.id,
      target_name: r.target.name,
      target_host: r.target.host,
      alive: r.alive,
      time_ms: r.time,
    })));

    setPingChartData(prev => {
      const newValues = {};
      results.forEach(r => { newValues[r.target.id] = r.time; });
      const validTimes = results.map(r => r.time).filter(t => typeof t === 'number' && !isNaN(t));
      const newAvg = validTimes.length > 0
        ? validTimes.reduce((a, b) => a + b, 0) / validTimes.length
        : null;
      const minTime = now - timeRange * 3600000;

      const newDatasets = prev.datasets.map(ds => {
        const newPoint = ds.label === 'Average'
          ? { x: now, y: newAvg }
          : (() => {
              const t = currentTargets.find(t => t.name === ds.label);
              return { x: now, y: t ? (newValues[t.id] ?? null) : null };
            })();
        return { ...ds, data: [...ds.data, newPoint].filter(p => p.x >= minTime) };
      });
      return { datasets: newDatasets };
    });
  }, [timeRange]);

  const addSpeedtestResult = useCallback((result) => {
    if (!result) return;
    setLatestSpeedtest(result);
    setSpeedtestChartData(prev => {
      // SSE events carry ISO timestamps ("...T...Z"), DB results carry SQLite format ("YYYY-MM-DD HH:MM:SS")
      const raw = result.timestamp;
      const ts = raw
        ? (raw.includes('T') ? new Date(raw).getTime() : parseUTCTimestamp(raw))
        : Date.now();
      const minTime = Date.now() - speedtestTimeRange * 3600000;
      const newDl = { x: ts, y: result.download != null ? parseFloat(result.download.toFixed(2)) : null };
      const newUl = { x: ts, y: result.upload != null ? parseFloat(result.upload.toFixed(2)) : null };
      const dl = [...(prev.datasets[0]?.data ?? []), newDl].filter(p => p.x >= minTime);
      const ul = [...(prev.datasets[1]?.data ?? []), newUl].filter(p => p.x >= minTime);
      return {
        datasets: [
          { ...(prev.datasets[0] ?? {}), data: dl },
          { ...(prev.datasets[1] ?? {}), data: ul },
        ],
      };
    });
  }, [speedtestTimeRange]);

  useEffect(() => {
    setChartNow(Date.now());
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    fetchSpeedtestChart();
  }, [fetchSpeedtestChart]);

  // SSE with exponential backoff
  useEffect(() => {
    let es = null;
    let retryDelay = 1000;
    let retryTimeout = null;

    const connect = () => {
      const apiBase = import.meta.env.VITE_API_URL || '/api';
      es = new EventSource(`${apiBase}/events`);

      es.onopen = () => { retryDelay = 1000; };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ping' && msg.data) {
            addPingResults(msg.data, targetsRef.current);
            setChartNow(Date.now());
          }
          if (msg.type === 'speedtest_started') {
            setRunningSpeedtest(true);
            setSpeedtestProgress(null);
            setShowSpeedtestResult(null);
          }
          if (msg.type === 'speedtest_progress') setSpeedtestProgress(msg.data);
          if (msg.type === 'speedtest') {
            setRunningSpeedtest(false);
            setSpeedtestProgress(null);
            if (msg.data) { setShowSpeedtestResult(msg.data); addSpeedtestResult(msg.data); }
          }
          if (msg.type === 'dns' && msg.data) {
            const normalized = msg.data.map(d => ({ ...d, time_ms: d.time_ms ?? d.timeMs ?? null }));
            setLatestDns(normalized);
            const ok = normalized.filter(d => d.success);
            if (ok.length > 0) setAvgDnsTime(ok.reduce((s, d) => s + (d.time_ms ?? 0), 0) / ok.length);
          }
          if (msg.type === 'publicip_change' && msg.data) {
            setLatestPublicIp({ ip_address: msg.data.ip, provider: msg.data.provider });
            setPublicIpChanges(prev => prev + 1);
          }
        } catch (e) { console.error('SSE parse error:', e); }
      };

      es.onerror = () => {
        es.close();
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
          connect();
        }, retryDelay + Math.random() * 500);
      };
    };

    connect();
    return () => {
      if (es) es.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [addPingResults, addSpeedtestResult]);

  // Periodic full refresh fallback
  useEffect(() => {
    const id = setInterval(fetchAllData, 300000);
    return () => clearInterval(id);
  }, [fetchAllData]);

  useEffect(() => {
    const id = setInterval(fetchSpeedtestChart, 300000);
    return () => clearInterval(id);
  }, [fetchSpeedtestChart]);

  const handleRunSpeedtest = async () => {
    try { await api.runSpeedtest(); }
    catch (err) { console.error('Failed to start speedtest:', err); setRunningSpeedtest(false); }
  };

  const handleRunPing = async () => {
    setRefreshingPing(true);
    try { await api.runPing(); }
    catch (err) { console.error('Failed to run ping:', err); }
    finally { setRefreshingPing(false); }
  };

  const handleRunDns = async () => {
    setRefreshingDns(true);
    try { await api.runDns(); }
    catch (err) { console.error('Failed to run DNS:', err); }
    finally { setRefreshingDns(false); }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div>Loading dashboard...</div>;
  }

  // Uptime: enabled targets only — disabled targets have no meaningful uptime
  const enabledTargets = targets.filter(t => t.enabled);
  const overallUptime = enabledTargets.length > 0
    ? enabledTargets.reduce((sum, t) => sum + (uptimeByTarget[t.id] ?? 0), 0) / enabledTargets.length
    : 0;

  const pingOptions = {
    ...baseChartOptions,
    scales: {
      x: {
        type: 'time',
        min: chartNow - timeRange * 3600000,
        max: chartNow,
        grid: { color: CT.grid },
        ticks: { color: CT.ticks, maxTicksLimit: 10 },
        time: { displayFormats: chartTimeFormats },
      },
      y: {
        ...baseChartOptions.scales.y,
        beginAtZero: true,
        title: { display: true, text: 'Latency (ms)', color: CT.ticks },
      },
    },
  };

  const speedtestOptions = {
    ...baseChartOptions,
    scales: {
      x: {
        type: 'time',
        min: chartNow - speedtestTimeRange * 3600000,
        max: chartNow,
        grid: { color: CT.grid },
        ticks: { color: CT.ticks, maxTicksLimit: 8 },
        time: { displayFormats: chartTimeFormats },
      },
      y: {
        ...baseChartOptions.scales.y,
        beginAtZero: true,
        title: { display: true, text: 'Speed (Mbps)', color: CT.ticks },
      },
    },
  };

  const hasSpeedtestData = speedtestChartData.datasets[0]?.data?.length > 0;

  return (
    <div>
      {/* Stats Cards */}
      <div className="dashboard-grid stats">
        <div className="card stat-card">
          <span className="stat-label">Overall Uptime</span>
          <span className={`stat-value ${overallUptime >= 99 ? 'success' : overallUptime >= 95 ? 'warning' : 'danger'}`}>
            {overallUptime.toFixed(1)}%
          </span>
          <span className="stat-subtitle">Last {formatTimeRange(timeRange)}</span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">Download Speed</span>
          <span className="stat-value">
            {latestSpeedtest?.download_mbps?.toFixed(1) || '—'} <small style={{ fontSize: '0.5em' }}>Mbps</small>
          </span>
          <span className="stat-subtitle">
            {latestSpeedtest ? formatDateTime(latestSpeedtest.timestamp) : 'No data'}
          </span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">Upload Speed</span>
          <span className="stat-value">
            {latestSpeedtest?.upload_mbps?.toFixed(1) || '—'} <small style={{ fontSize: '0.5em' }}>Mbps</small>
          </span>
          <span className="stat-subtitle">{latestSpeedtest?.server_name || 'No server'}</span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">Latency</span>
          <span className="stat-value">
            {latestSpeedtest?.ping_ms?.toFixed(0) || '—'} <small style={{ fontSize: '0.5em' }}>ms</small>
          </span>
          <span className="stat-subtitle">
            Jitter: {latestSpeedtest?.jitter_ms?.toFixed(1) || '—'} ms
          </span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">DNS Resolution</span>
          <span className="stat-value">
            {avgDnsTime?.toFixed(1) || '—'} <small style={{ fontSize: '0.5em' }}>ms</small>
          </span>
          <span className="stat-subtitle">
            {latestDns.filter(d => d.success).length}/{latestDns.length} domains OK
          </span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">Public IP</span>
          <span className="stat-value" style={{ fontSize: '1.2rem', wordBreak: 'break-all' }}>
            {latestPublicIp?.ip_address || '—'}
          </span>
          <span className="stat-subtitle">
            {publicIpChanges > 0
              ? `${publicIpChanges} change${publicIpChanges > 1 ? 's' : ''} in selected period`
              : `Stable for ${formatTimeRange(timeRange)}`}
          </span>
        </div>
      </div>

      {/* Connection Status */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">Connection Status</h3>
          <button onClick={handleRunPing} disabled={refreshingPing}>
            {refreshingPing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="status-grid">
          {latestPings.map(ping => (
            <div key={ping.target_id} className="status-item">
              <div className={`status-indicator ${ping.alive ? 'online' : 'offline'}`}></div>
              <div className="status-info">
                <div className="status-name">{ping.target_name}</div>
                <div className="status-details">{ping.target_host}</div>
              </div>
              <div className="status-latency">
                {ping.alive ? `${ping.time_ms?.toFixed(1)} ms` : 'Offline'}
              </div>
            </div>
          ))}
          {latestPings.length === 0 && <div className="empty-state">No ping targets configured</div>}
        </div>
      </div>

      {/* DNS Status */}
      {latestDns.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <h3 className="card-title">DNS Resolution</h3>
            <button onClick={handleRunDns} disabled={refreshingDns}>
              {refreshingDns ? 'Checking...' : 'Refresh'}
            </button>
          </div>
          <div className="status-grid">
            {latestDns.map((dns, idx) => (
              <div key={dns.domain || idx} className="status-item">
                <div className={`status-indicator ${dns.success ? 'online' : 'offline'}`}></div>
                <div className="status-info">
                  <div className="status-name">{dns.domain}</div>
                  <div className="status-details">{dns.resolver || 'system'}</div>
                </div>
                <div className="status-latency">
                  {dns.success ? `${dns.time_ms?.toFixed(1)} ms` : dns.error || 'Failed'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="dashboard-grid">
        {/* Ping Latency */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Ping Latency</h3>
            <div className="chart-controls">
              <div className="view-mode-selector">
                <button className={pingViewMode === 'all' ? 'active' : ''} onClick={() => setPingViewMode('all')}>All</button>
                <button className={pingViewMode === 'average' ? 'active' : ''} onClick={() => setPingViewMode('average')}>Average</button>
              </div>
              <div className="time-range-selector">
                {TIME_RANGES.map(r => (
                  <button key={r.label} className={timeRange === r.value ? 'active' : ''} onClick={() => setTimeRange(r.value)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-container">
            {pingChartLoading ? (
              <div className="loading"><div className="spinner"></div>Loading chart...</div>
            ) : pingChartData.datasets.length > 0 ? (
              <Line
                ref={pingChartRef}
                data={{
                  datasets: pingViewMode === 'average'
                    ? pingChartData.datasets.filter(ds => ds.label === 'Average').map(ds => ({ ...ds, borderDash: [], borderWidth: 2 }))
                    : pingChartData.datasets.filter(ds => ds.label !== 'Average')
                }}
                options={pingOptions}
              />
            ) : (
              <div className="empty-state">No ping data available</div>
            )}
          </div>
        </div>

        {/* Speedtest */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Speed Test History</h3>
            <div className="chart-controls">
              <div className="time-range-selector">
                {SPEEDTEST_TIME_RANGES.map(r => (
                  <button key={r.label} className={speedtestTimeRange === r.value ? 'active' : ''} onClick={() => setSpeedtestTimeRange(r.value)}>
                    {r.label}
                  </button>
                ))}
              </div>
              <button className="primary" onClick={handleRunSpeedtest} disabled={runningSpeedtest}>
                {runningSpeedtest ? 'Running...' : 'Run Speedtest'}
              </button>
            </div>
          </div>

          {runningSpeedtest && (
            <div className="speedtest-progress">
              <div className="progress-phase">
                {speedtestProgress?.phase === 'connecting' && 'Connecting to server...'}
                {speedtestProgress?.phase === 'testing' && 'Running speed test...'}
                {speedtestProgress?.phase === 'ping' && 'Testing latency...'}
                {speedtestProgress?.phase === 'download' && 'Testing download...'}
                {speedtestProgress?.phase === 'upload' && 'Testing upload...'}
                {!speedtestProgress?.phase && 'Starting...'}
              </div>
              <div className="progress-stats">
                {(speedtestProgress?.phase === 'connecting' || speedtestProgress?.phase === 'testing') && (
                  <div className="progress-stat">
                    <span className="progress-message">{speedtestProgress.message || 'Please wait...'}</span>
                  </div>
                )}
                {speedtestProgress?.phase === 'ping' && speedtestProgress.ping > 0 && (
                  <div className="progress-stat">
                    <span className="progress-label">Ping</span>
                    <span className="progress-value">{speedtestProgress.ping.toFixed(0)} ms</span>
                  </div>
                )}
                {speedtestProgress?.phase === 'download' && (
                  <>
                    <div className="progress-stat">
                      <span className="progress-label">Download</span>
                      <span className="progress-value highlight-download">{speedtestProgress.download.toFixed(1)} Mbps</span>
                    </div>
                    <div className="progress-bar-container">
                      <div className="progress-bar download" style={{ width: `${(speedtestProgress.progress || 0) * 100}%` }}></div>
                    </div>
                  </>
                )}
                {speedtestProgress?.phase === 'upload' && (
                  <>
                    <div className="progress-stat">
                      <span className="progress-label">Upload</span>
                      <span className="progress-value highlight-upload">{speedtestProgress.upload.toFixed(1)} Mbps</span>
                    </div>
                    <div className="progress-bar-container">
                      <div className="progress-bar upload" style={{ width: `${(speedtestProgress.progress || 0) * 100}%` }}></div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {!runningSpeedtest && showSpeedtestResult && (
            <div className="speedtest-result">
              <div className="result-header">
                <span className="result-title">Speed Test Complete</span>
                <span className="result-server">{showSpeedtestResult.serverName} — {showSpeedtestResult.serverLocation}</span>
              </div>
              <div className="result-stats">
                <div className="result-stat">
                  <span className="result-label">Download</span>
                  <span className="result-value highlight-download">{showSpeedtestResult.download?.toFixed(1)} Mbps</span>
                </div>
                <div className="result-stat">
                  <span className="result-label">Upload</span>
                  <span className="result-value highlight-upload">{showSpeedtestResult.upload?.toFixed(1)} Mbps</span>
                </div>
                <div className="result-stat">
                  <span className="result-label">Ping</span>
                  <span className="result-value">{showSpeedtestResult.ping?.toFixed(0)} ms</span>
                </div>
                <div className="result-stat">
                  <span className="result-label">Jitter</span>
                  <span className="result-value">{showSpeedtestResult.jitter?.toFixed(1)} ms</span>
                </div>
              </div>
              <button className="back-to-graph" onClick={() => setShowSpeedtestResult(null)}>Back to Graph</button>
            </div>
          )}

          <div className="chart-container" style={{ display: (runningSpeedtest || showSpeedtestResult) ? 'none' : 'block' }}>
            {speedtestChartLoading ? (
              <div className="loading"><div className="spinner"></div>Loading chart...</div>
            ) : hasSpeedtestData ? (
              <Line ref={speedtestChartRef} data={speedtestChartData} options={speedtestOptions} />
            ) : (
              <div className="empty-state">No speedtest data yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Target Statistics Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Target Statistics</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Host</th>
              <th>Uptime</th>
              <th>Avg Latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(target => {
              const isDisabled = !target.enabled;
              const latestPing = latestPings.find(p => p.target_id === target.id);
              const uptime = uptimeByTarget[target.id] ?? 0;
              const avgLatency = avgLatencyByTarget[target.id];

              let statusClass = 'danger', statusText = 'Offline';
              if (isDisabled) { statusClass = 'warning'; statusText = 'Disabled'; }
              else if (latestPing?.alive) { statusClass = 'success'; statusText = 'Online'; }

              return (
                <tr key={target.id} style={{ opacity: isDisabled ? 0.6 : 1 }}>
                  <td>{target.name}</td>
                  <td><code>{target.host}</code></td>
                  <td>
                    {isDisabled ? '—' : (
                      <span className={`badge ${uptime >= 99 ? 'success' : uptime >= 95 ? 'warning' : 'danger'}`}>
                        {uptime.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td>{isDisabled ? '—' : (avgLatency ? `${avgLatency.toFixed(1)} ms` : '—')}</td>
                  <td><span className={`badge ${statusClass}`}>{statusText}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
