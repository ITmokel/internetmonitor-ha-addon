import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { useLocale } from '../lib/locale';

export default function Config() {
  const { locale, setLocale } = useLocale();
  const [config, setConfig] = useState({});
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTarget, setNewTarget] = useState({ name: '', host: '' });
  const [testResult, setTestResult] = useState(null);
  const [addError, setAddError] = useState(null);
  const [saving, setSaving] = useState({});
  const dnsDebounceRef = useRef(null);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null); // {deleted, retentionDays} | {error: true}

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [configData, targetsData] = await Promise.all([
        api.getConfig(),
        api.getTargets(),
      ]);
      setConfig(configData);
      setTargets(targetsData);
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = async (key, value) => {
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      await api.setConfig(key, value);
      setConfig(prev => ({ ...prev, [key]: value }));
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleAddTarget = async (e) => {
    e.preventDefault();
    if (!newTarget.name || !newTarget.host) return;
    setAddError(null);
    try {
      const added = await api.addTarget(newTarget.name, newTarget.host);
      setTargets(prev => [...prev, added]);
      setNewTarget({ name: '', host: '' });
      setTestResult(null);
    } catch (err) {
      // 409 = duplicate host
      setAddError(err.message?.includes('409') ? `Host "${newTarget.host}" is already configured.` : 'Failed to add target.');
    }
  };

  const handleDeleteTarget = async (id) => {
    if (!confirm('Delete this ping target?')) return;
    try {
      await api.deleteTarget(id);
      setTargets(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error('Failed to delete target:', err);
    }
  };

  const handleToggleTarget = async (target) => {
    try {
      await api.updateTarget(target.id, {
        name: target.name,
        host: target.host,
        enabled: !target.enabled,
      });
      setTargets(prev => prev.map(t =>
        t.id === target.id ? { ...t, enabled: t.enabled ? 0 : 1 } : t
      ));
    } catch (err) {
      console.error('Failed to toggle target:', err);
    }
  };

  const handleTestPing = async () => {
    if (!newTarget.host) return;
    setTestResult({ testing: true });
    try {
      const result = await api.testPing(newTarget.host);
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: err.message });
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const result = await api.cleanup();
      setCleanupResult(result);
      setShowCleanupConfirm(false);
      setTimeout(() => setCleanupResult(null), 6000);
    } catch (err) {
      console.error('Cleanup failed:', err);
      setCleanupResult({ error: true });
      setTimeout(() => setCleanupResult(null), 4000);
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        Loading configuration...
      </div>
    );
  }

  return (
    <div>
      {/* Monitoring Settings */}
      <div className="card config-section">
        <h2 className="config-section-title">Monitoring Settings</h2>

        <div className="config-row">
          <label htmlFor="ping-interval">Ping Interval</label>
          <select
            id="ping-interval"
            value={config.ping_interval_seconds || '60'}
            onChange={(e) => handleConfigChange('ping_interval_seconds', e.target.value)}
            disabled={saving.ping_interval_seconds}
          >
            <option value="10">10 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">1 minute</option>
            <option value="300">5 minutes</option>
          </select>
        </div>

        <div className="config-row">
          <label htmlFor="speedtest-interval">Speedtest Interval</label>
          <select
            id="speedtest-interval"
            value={config.speedtest_interval_minutes || '60'}
            onChange={(e) => handleConfigChange('speedtest_interval_minutes', e.target.value)}
            disabled={saving.speedtest_interval_minutes}
          >
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="240">4 hours</option>
            <option value="360">6 hours</option>
            <option value="720">12 hours</option>
            <option value="1440">24 hours</option>
          </select>
        </div>

        <div className="config-row">
          <label htmlFor="data-retention">Data Retention</label>
          <select
            id="data-retention"
            value={config.data_retention_days || '365'}
            onChange={(e) => handleConfigChange('data_retention_days', e.target.value)}
            disabled={saving.data_retention_days}
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">6 months</option>
            <option value="365">1 year</option>
            <option value="730">2 years</option>
            <option value="1825">5 years</option>
          </select>
        </div>

        <div className="config-row">
          <label htmlFor="dns-interval">DNS Check Interval</label>
          <select
            id="dns-interval"
            value={config.dns_interval_seconds || '60'}
            onChange={(e) => handleConfigChange('dns_interval_seconds', e.target.value)}
            disabled={saving.dns_interval_seconds}
          >
            <option value="30">30 seconds</option>
            <option value="60">1 minute</option>
            <option value="120">2 minutes</option>
            <option value="300">5 minutes</option>
          </select>
        </div>

        <div className="config-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
          <label htmlFor="dns-domains">DNS Domains (comma-separated)</label>
          <textarea
            id="dns-domains"
            value={config.dns_domains || 'google.com,cloudflare.com,amazon.com'}
            onChange={(e) => {
              const val = e.target.value;
              setConfig(prev => ({ ...prev, dns_domains: val }));
              clearTimeout(dnsDebounceRef.current);
              dnsDebounceRef.current = setTimeout(() => handleConfigChange('dns_domains', val), 800);
            }}
            disabled={saving.dns_domains}
            rows={2}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--text-base)',
              resize: 'vertical',
            }}
          />
        </div>

        <div className="config-row">
          <label htmlFor="publicip-interval">Public IP Check Interval</label>
          <select
            id="publicip-interval"
            value={config.publicip_interval_minutes || '15'}
            onChange={(e) => handleConfigChange('publicip_interval_minutes', e.target.value)}
            disabled={saving.publicip_interval_minutes}
          >
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
          </select>
        </div>

        <div className="config-row">
          <label htmlFor="locale">Date &amp; Time Format</label>
          <select
            id="locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            <option value="en">English — May 22, 14:30</option>
            <option value="eu">European — 22.05.2026, 14:30</option>
          </select>
        </div>
      </div>

      {/* Ping Targets */}
      <div className="card config-section">
        <h2 className="config-section-title">Ping Targets</h2>

        <div className="target-list">
          {targets.map(target => (
            <div key={target.id} className="target-item">
              <span className="name">{target.name}</span>
              <span className="host">{target.host}</span>
              <span className="status">
                <span className={`badge ${target.enabled ? 'success' : 'warning'}`}>
                  {target.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </span>
              <div className="actions">
                <button onClick={() => handleToggleTarget(target)}>
                  {target.enabled ? 'Disable' : 'Enable'}
                </button>
                <button className="danger" onClick={() => handleDeleteTarget(target.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}

          {targets.length === 0 && (
            <div className="empty-state">No ping targets configured</div>
          )}
        </div>

        <form className="add-target-form" onSubmit={handleAddTarget}>
          <input
            type="text"
            placeholder="Name (e.g., Google DNS)"
            value={newTarget.name}
            onChange={(e) => setNewTarget(prev => ({ ...prev, name: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Host (e.g., 8.8.8.8)"
            value={newTarget.host}
            onChange={(e) => setNewTarget(prev => ({ ...prev, host: e.target.value }))}
          />
          <button type="button" onClick={handleTestPing} disabled={!newTarget.host}>
            Test
          </button>
          <button type="submit" className="primary" disabled={!newTarget.name || !newTarget.host}>
            Add Target
          </button>
        </form>

        {addError && (
          <div style={{
            marginTop: '0.75rem',
            padding: '0.75rem 1rem',
            background: 'var(--color-error-bg)',
            border: '1px solid var(--color-error-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error-text)',
            fontSize: 'var(--text-base)',
          }}>
            {addError}
          </div>
        )}

        {testResult && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-base)',
          }}>
            {testResult.testing ? (
              <span style={{ color: 'var(--color-text-muted)' }}>Testing connection...</span>
            ) : testResult.error ? (
              <span style={{ color: 'var(--color-error-text)' }}>Error: {testResult.error}</span>
            ) : testResult.alive ? (
              <span style={{ color: 'var(--color-success-text)' }}>
                Reachable — Latency: {testResult.time?.toFixed(1)} ms, Packet Loss: {testResult.packetLoss}%
              </span>
            ) : (
              <span style={{ color: 'var(--color-error-text)' }}>Host unreachable</span>
            )}
          </div>
        )}
      </div>

      {/* Maintenance */}
      <div className="card config-section">
        <h2 className="config-section-title">Maintenance</h2>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', fontSize: 'var(--text-base)' }}>
          Remove all data older than the configured retention period ({config.data_retention_days || 365} days).
        </p>

        {!showCleanupConfirm && !cleanupResult && (
          <button className="danger" onClick={() => setShowCleanupConfirm(true)}>
            Cleanup Old Data
          </button>
        )}

        {showCleanupConfirm && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '0.75rem 1rem',
            background: 'var(--color-error-bg)',
            border: '1px solid var(--color-error-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            <span style={{ color: 'var(--color-error-text)', flex: 1 }}>
              Delete all data older than {config.data_retention_days || 365} days?
            </span>
            <button
              className="danger"
              onClick={handleCleanup}
              disabled={cleaning}
            >
              {cleaning ? 'Cleaning...' : 'Yes, delete'}
            </button>
            <button onClick={() => setShowCleanupConfirm(false)} disabled={cleaning}>
              Cancel
            </button>
          </div>
        )}

        {cleanupResult && !cleanupResult.error && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-success-text)',
          }}>
            Done — {cleanupResult.deleted.toLocaleString()} {cleanupResult.deleted === 1 ? 'entry' : 'entries'} removed
            (retention: {cleanupResult.retentionDays} days).
          </div>
        )}
        {cleanupResult?.error && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'var(--color-error-bg)',
            border: '1px solid var(--color-error-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error-text)',
          }}>
            Cleanup failed. Check the addon logs.
          </div>
        )}
      </div>
    </div>
  );
}
