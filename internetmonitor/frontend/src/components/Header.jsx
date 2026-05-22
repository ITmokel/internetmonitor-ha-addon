import { NavLink } from 'react-router-dom';

const VERSION = '1.0.14';

export default function Header() {
  return (
    <header className="header">
      <div className="header-brand">
        <img src="/itmokel-logo.png" alt="ITMokel" className="header-logo" />
        <div>
          <span className="header-title">Internet Monitor</span>
          <span className="header-version">v{VERSION}</span>
        </div>
      </div>
      <nav className="header-nav">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Dashboard
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Reports
        </NavLink>
        <NavLink to="/config" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Configuration
        </NavLink>
      </nav>
    </header>
  );
}
