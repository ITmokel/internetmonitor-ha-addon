import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from './api';

const STORAGE_KEY = 'internetmonitor_locale';

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  // Initialise from localStorage so the correct format is shown immediately,
  // then confirm / override with the value stored in the backend config.
  const [locale, setLocaleState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'en'
  );

  useEffect(() => {
    api.getConfig()
      .then(cfg => {
        const l = cfg.locale || 'en';
        setLocaleState(l);
        localStorage.setItem(STORAGE_KEY, l);
      })
      .catch(() => {});
  }, []);

  const setLocale = useCallback(async (newLocale) => {
    await api.setConfig('locale', newLocale);
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  // Full date + time string
  const formatDateTime = useCallback((timestamp) => {
    if (!timestamp) return '—';
    const raw = typeof timestamp === 'string'
      ? timestamp.replace(' ', 'T') + (timestamp.endsWith('Z') ? '' : 'Z')
      : timestamp;
    const date = new Date(raw);
    if (isNaN(date)) return '—';
    return locale === 'eu'
      ? date.toLocaleString('de-DE')
      : date.toLocaleString('en-US', { hour12: false });
  }, [locale]);

  // Short form used in chart tooltips, stat card subtitles, etc.
  const formatDateShort = useCallback((timestamp) => {
    if (!timestamp) return '—';
    const raw = typeof timestamp === 'string'
      ? timestamp.replace(' ', 'T') + (timestamp.endsWith('Z') ? '' : 'Z')
      : timestamp;
    const date = new Date(raw);
    if (isNaN(date)) return '—';
    const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
    return locale === 'eu'
      ? date.toLocaleString('de-DE', opts)
      : date.toLocaleString('en-US', opts);
  }, [locale]);

  // date-fns format strings for Chart.js TimeScale axes
  const chartTimeFormats = locale === 'eu'
    ? { second: 'HH:mm:ss', minute: 'HH:mm', hour: 'HH:mm', day: 'dd.MM.', week: 'dd.MM.', month: 'MM.yyyy' }
    : { second: 'HH:mm:ss', minute: 'HH:mm', hour: 'HH:mm', day: 'MMM d',  week: 'MMM d',  month: 'MMM yyyy' };

  return (
    <LocaleContext.Provider value={{ locale, setLocale, formatDateTime, formatDateShort, chartTimeFormats }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside <LocaleProvider>');
  return ctx;
}
