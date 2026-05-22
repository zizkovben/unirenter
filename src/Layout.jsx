import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './Layout.css'
function citySwitcherUrls(path) {
  if (path.includes('lease'))   return { melbourne: '/lease',   sydney: '/lease-sydney',   brisbane: '/lease-brisbane' }
  if (path.includes('guide'))   return { melbourne: '/guide',   sydney: '/guide-sydney',   brisbane: '/guide-brisbane' }
  if (path.includes('settled')) return { melbourne: '/settled', sydney: '/settled-sydney', brisbane: '/settled-brisbane' }
  return                                { melbourne: '/',        sydney: '/sydney',         brisbane: '/brisbane' }
}
function navUrls(city) {
  if (city === 'melbourne') return { home: '/',         lease: '/lease',          guide: '/guide',          settled: '/settled' }
  if (city === 'sydney')    return { home: '/sydney',   lease: '/lease-sydney',   guide: '/guide-sydney',   settled: '/settled-sydney' }
  return                           { home: '/brisbane', lease: '/lease-brisbane', guide: '/guide-brisbane', settled: '/settled-brisbane' }
}
export default function Layout({ city, children }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const sw  = citySwitcherUrls(pathname)
  const nav = navUrls(city)
  const activeCity = pathname === '/sydney' || pathname.includes('-sydney') ? 'sydney' : pathname === '/brisbane' || pathname.includes('-brisbane') ? 'brisbane' : 'melbourne'
  return (
    <>
      <header>
        <nav className="navbar">
          <Link to="/" className="logo"><span className="logo-uni">Uni</span><span className="logo-rent">Renter</span></Link>
          <div className="nav-desktop">
            <Link to={nav.home}    className={`nav-link${pathname === nav.home    ? ' active' : ''}`}>Find a Housemate</Link>
            <Link to={nav.lease}   className={`nav-link${pathname === nav.lease   ? ' active' : ''}`}>Find Housing</Link>
            <Link to={nav.guide}   className={`nav-link${pathname === nav.guide   ? ' active' : ''}`}>Tenant Guide</Link>
            <Link to={nav.settled} className={`nav-link${pathname === nav.settled ? ' active' : ''}`}>Getting Settled</Link>
          </div>
          <button className="hamburger" onClick={() => setOpen(!open)} aria-label="Menu">
            <span /><span /><span />
          </button>
        </nav>
        <div className="city-bar">
          <span className="city-label">City</span>
          <Link to={sw.melbourne} className={`city-btn${activeCity === 'melbourne' ? ' active' : ''}`}>🏙️ Melbourne</Link>
          <Link to={sw.sydney}    className={`city-btn${activeCity === 'sydney'    ? ' active' : ''}`}>🌉 Sydney</Link>
          <Link to={sw.brisbane}  className={`city-btn${activeCity === 'brisbane'  ? ' active' : ''}`}>☀️ Brisbane</Link>
        </div>
        {open && (
          <div className="mobile-menu">
            <Link to={nav.home}    onClick={() => setOpen(false)}>🏠 Find a Housemate</Link>
            <Link to={nav.lease}   onClick={() => setOpen(false)}>🔑 Find Housing</Link>
            <Link to={nav.guide}   onClick={() => setOpen(false)}>📋 Tenant Guide</Link>
            <Link to={nav.settled} onClick={() => setOpen(false)}>🌏 Getting Settled</Link>
            <div className="mob-divider" />
            <Link to="/dashboard"  onClick={() => setOpen(false)}>📅 Dashboard</Link>
            <Link to="/legal"      onClick={() => setOpen(false)}>⚖️ Legal & Privacy</Link>
          </div>
        )}
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-col footer-brand">
            <Link to="/" className="footer-logo"><span className="logo-uni">Uni</span>Renter</Link>
            <p>Helping students settle into Australian life — fast, safely, and for the right price.</p>
          </div>
          <div className="footer-col">
            <h4>Platform</h4>
            <Link to={nav.home}>Find a Housemate</Link>
            <Link to={nav.lease}>Find Housing</Link>
            <Link to={nav.guide}>Tenant Guide</Link>
            <Link to={nav.settled}>Getting Settled</Link>
          </div>
          <div className="footer-col">
            <h4>Cities</h4>
            <Link to="/">Melbourne</Link>
            <Link to="/sydney">Sydney</Link>
            <Link to="/brisbane">Brisbane</Link>
          </div>
          <div className="footer-col">
            <h4>Legal</h4>
            <Link to="/legal">Terms & Conditions</Link>
            <Link to="/legal">Privacy Policy</Link>
            <Link to="/legal">Disclaimer</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2025 UniRenter · Not a real estate agent · Not a social media platform</span>
          <span>Cob™ · Oi Cob!™</span>
        </div>
      </footer>
    </>
  )
}
