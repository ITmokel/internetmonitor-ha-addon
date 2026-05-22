import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import api from '../lib/api';
import { CT } from '../lib/chartTheme';
import { useLocale } from '../lib/locale';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

const PERIODS = [
  { value: '24h', label: '24 Hours' },
  { value: '7d',  label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
];

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'top', labels: { color: CT.ticks } } },
  scales: {
    x: { grid: { color: CT.grid }, ticks: { color: CT.ticks } },
    y: { grid: { color: CT.grid }, ticks: { color: CT.ticks }, beginAtZero: true },
  },
};

const uptimeChartOptions = {
  ...chartOptions,
  scales: {
    ...chartOptions.scales,
    y: {
      ...chartOptions.scales.y,
      max: 100,
      ticks: { ...chartOptions.scales.y.ticks, callback: v => `${v}%` },
    },
  },
};

export default function Reports() {
  const { formatDateTime } = useLocale();
  const [period, setPeriod] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!loading) setRefreshing(true);

    api.getReports(period)
      .then(data => { if (!cancelled) setReport(data); })
      .catch(err => console.error('Failed to load report:', err))
      .finally(() => { if (!cancelled) { setLoading(false); setRefreshing(false); } });

    return () => { cancelled = true; };
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="loading"><div className="spinner"></div>Loading report...</div>;
  }

  if (!report) {
    return <div className="empty-state">Failed to load report data</div>;
  }

  const uptimeChartData = {
    labels: report.dailyStats.map(d => d.date),
    datasets: [{
      label: 'Uptime %',
      data: report.dailyStats.map(d =>
        d.ping_checks > 0 ? (d.successful_pings / d.ping_checks * 100).toFixed(1) : 0
      ),
      backgroundColor: report.dailyStats.map(d => {
        const u = d.ping_checks > 0 ? (d.successful_pings / d.ping_checks * 100) : 100;
        return u >= 99 ? CT.success : u >= 95 ? CT.warning : CT.error;
      }),
      borderRadius: 4,
    }],
  };

  const speedChartData = {
    labels: report.dailySpeedtest.map(d => d.date),
    datasets: [
      {
        label: 'Avg Download (Mbps)',
        data: report.dailySpeedtest.map(d => d.avg_download?.toFixed(1)),
        borderColor: CT.success,
        backgroundColor: CT.success + '20',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'Avg Upload (Mbps)',
        data: report.dailySpeedtest.map(d => d.avg_upload?.toFixed(1)),
        borderColor: CT.blue,
        backgroundColor: CT.blue + '20',
        tension: 0.3,
        fill: true,
      },
    ],
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Subtle overlay while switching periods */}
      {refreshing && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'rgba(13,17,23,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-lg)',
        }}>
          <div className="loading" style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', padding: '1rem 2rem' }}>
            <div className="spinner"></div>
            Loading...
          </div>
        </div>
      )}

      {/* Period Selector */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">Report Period</h3>
          <div className="time-range-selector">
            {PERIODS.map(p => (
              <button
                key={p.value}
                className={period === p.value ? 'active' : ''}
                onClick={() => setPeriod(p.value)}
                disabled={refreshing}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="dashboard-grid stats">
        <div className="card stat-card">
          <span className="stat-label">Overall Uptime</span>
          <span className={`stat-value ${report.ping.uptimePercent >= 99 ? 'success' : report.ping.uptimePercent >= 95 ? 'warning' : 'danger'}`}>
            {report.ping.uptimePercent.toFixed(2)}%
          </span>
          <span className="stat-subtitle">
            {report.ping.successfulPings.toLocaleString()} / {report.ping.totalChecks.toLocaleString()} checks
          </span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">Avg Download</span>
          <span className="stat-value">
            {report.speedtest.avgDownload?.toFixed(1) || '—'} <small style={{ fontSize: '0.5em' }}>Mbps</small>
          </span>
          <span className="stat-subtitle">
            Min: {report.speedtest.minDownload?.toFixed(1) || '—'} / Max: {report.speedtest.maxDownload?.toFixed(1) || '—'}
          </span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">Avg Upload</span>
          <span className="stat-value">
            {report.speedtest.avgUpload?.toFixed(1) || '—'} <small style={{ fontSize: '0.5em' }}>Mbps</small>
          </span>
          <span className="stat-subtitle">
            Min: {report.speedtest.minUpload?.toFixed(1) || '—'} / Max: {report.speedtest.maxUpload?.toFixed(1) || '—'}
          </span>
        </div>

        <div className="card stat-card">
          <span className="stat-label">IP Changes</span>
          <span className="stat-value">{report.publicIp.changes}</span>
          <span className="stat-subtitle">In selected period</span>
        </div>
      </div>

      {/* Charts */}
      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header"><h3 className="card-title">Daily Uptime</h3></div>
          <div className="chart-container">
            {report.dailyStats.length > 0
              ? <Bar data={uptimeChartData} options={uptimeChartOptions} />
              : <div className="empty-state">No data for this period</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title">Daily Speed Averages</h3></div>
          <div className="chart-container">
            {report.dailySpeedtest.length > 0
              ? <Line data={speedChartData} options={chartOptions} />
              : <div className="empty-state">No speedtest data for this period</div>}
          </div>
        </div>
      </div>

      {/* Ping Statistics */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header"><h3 className="card-title">Ping Statistics</h3></div>
        <table className="data-table">
          <tbody>
            <tr><td>Total Checks</td><td>{report.ping.totalChecks.toLocaleString()}</td></tr>
            <tr><td>Successful Pings</td><td>{report.ping.successfulPings.toLocaleString()}</td></tr>
            <tr><td>Uptime</td><td>{report.ping.uptimePercent.toFixed(2)}%</td></tr>
            <tr><td>Average Latency</td><td>{report.ping.avgLatency?.toFixed(2) || '—'} ms</td></tr>
            <tr><td>Min Latency</td><td>{report.ping.minLatency?.toFixed(2) || '—'} ms</td></tr>
            <tr><td>Max Latency</td><td>{report.ping.maxLatency?.toFixed(2) || '—'} ms</td></tr>
          </tbody>
        </table>
      </div>

      <div className="dashboard-grid" style={{ marginTop: '1.5rem' }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">DNS Statistics</h3></div>
          <table className="data-table">
            <tbody>
              <tr><td>Total Lookups</td><td>{report.dns.totalLookups.toLocaleString()}</td></tr>
              <tr><td>Successful</td><td>{report.dns.successfulLookups.toLocaleString()}</td></tr>
              <tr><td>Success Rate</td><td>{report.dns.successRate.toFixed(2)}%</td></tr>
              <tr><td>Avg Resolution</td><td>{report.dns.avgTime?.toFixed(2) || '—'} ms</td></tr>
              <tr><td>Min / Max</td><td>{report.dns.minTime?.toFixed(2) || '—'} / {report.dns.maxTime?.toFixed(2) || '—'} ms</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title">Speedtest Statistics</h3></div>
          <table className="data-table">
            <tbody>
              <tr><td>Total Tests</td><td>{report.speedtest.totalTests}</td></tr>
              <tr><td>Avg Download</td><td>{report.speedtest.avgDownload?.toFixed(2) || '—'} Mbps</td></tr>
              <tr><td>Avg Upload</td><td>{report.speedtest.avgUpload?.toFixed(2) || '—'} Mbps</td></tr>
              <tr><td>Avg Ping</td><td>{report.speedtest.avgPing?.toFixed(2) || '—'} ms</td></tr>
              <tr><td>Avg Jitter</td><td>{report.speedtest.avgJitter?.toFixed(2) || '—'} ms</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {report.worstDays?.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="card-header"><h3 className="card-title">Worst Days by Uptime</h3></div>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Uptime</th><th>Successful / Total</th></tr>
            </thead>
            <tbody>
              {report.worstDays.map((day, idx) => (
                <tr key={idx}>
                  <td>{day.date}</td>
                  <td>
                    <span className={`badge ${day.uptime_percent >= 99 ? 'success' : day.uptime_percent >= 95 ? 'warning' : 'danger'}`}>
                      {day.uptime_percent.toFixed(1)}%
                    </span>
                  </td>
                  <td>{day.successful_pings} / {day.total_checks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.outages?.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="card-header"><h3 className="card-title">Detected Outages</h3></div>
          <table className="data-table">
            <thead>
              <tr><th>Start Time</th><th>End Time</th><th>Failed Checks</th></tr>
            </thead>
            <tbody>
              {report.outages.map((outage, idx) => (
                <tr key={idx}>
                  <td>{formatDateTime(outage.start_time)}</td>
                  <td>{formatDateTime(outage.end_time)}</td>
                  <td>{outage.failed_checks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
