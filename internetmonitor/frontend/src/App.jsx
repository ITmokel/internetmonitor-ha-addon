import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import { LocaleProvider } from './lib/locale';
import './App.css';

// Route-level lazy loading: Chart.js (and all page code) only loads when that page is first visited.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Config    = lazy(() => import('./pages/Config'));
const Reports   = lazy(() => import('./pages/Reports'));

function PageLoader() {
  return (
    <div className="loading">
      <div className="spinner"></div>
      Loading...
    </div>
  );
}

function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <div className="app">
          <Header />
          <main className="main">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/"        element={<Dashboard />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/config"  element={<Config />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </BrowserRouter>
    </LocaleProvider>
  );
}

export default App;
