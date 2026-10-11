import React, { useState, useEffect } from 'react';
import {
  Download,
  ShieldCheck,
  Users,
  MessageSquare,
  Lock,
  Sparkles,
  ArrowRight,
  Monitor,
  Flame,
  CheckCircle2,
  Crown,
  ShieldAlert,
  Hash,
  RefreshCw
} from 'lucide-react';

export default function LandingPage({ onOpenApp, onOpenLogin, onOpenRegister }) {
  const [releaseInfo, setReleaseInfo] = useState({
    version: '1.0.2',
    fileName: 'Mingle-Setup-1.0.2.exe',
    fileSizeMb: 107,
    ready: true
  });

  useEffect(() => {
    fetch('/api/release/info')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.version) {
          setReleaseInfo(data);
        }
      })
      .catch(() => { });
  }, []);

  return (
    <div className="landing-container">
      {/* ── Navigation ────────────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <span className="brand-logo-glow">
              <MessageSquare size={22} className="brand-icon" />
            </span>
            <span className="brand-title">mingle<span>.</span></span>
          </div>

          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#roles">Rollen &amp; Server</a>
            <a href="#security">Sicherheit &amp; 2FA</a>
            <a href="#download">Download</a>
          </div>

          <div className="landing-nav-actions">
            <button className="button-nav-login" onClick={onOpenLogin}>
              Anmelden
            </button>
            <a href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Windows-1.0.2.zip" className="button-nav-app" download>
              Download (.zip)
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ──────────────────────────────────────────────────────── */}
      <header className="landing-hero">
        <div className="hero-glow-sphere" />
        <div className="hero-badge">
          <Sparkles size={15} />
          <span>Mingle v{releaseInfo.version} • Community Messenger mit Auto-Updates</span>
        </div>

        <h1 className="hero-heading">
          Dein Raum für <span className="text-gradient">echte Gespräche</span> &amp; Communities.
        </h1>

        <p className="hero-subtext">
          Erstelle eigene Server mit Textkanälen, verteile Rollen von Owner bis Moderator,
          schütze dein Profil mit 2FA und chatte in Echtzeit.
          Ganz normal installierbar – mit automatischen Updates direkt beim Start.
        </p>

        <div className="hero-actions">
          <a href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Windows-1.0.2.zip" className="btn-hero-primary" download>
            <Download size={20} />
            <div className="btn-text-block">
              <span className="btn-main-label">Download (.zip)</span>
              <span className="btn-sub-label">Empfohlen • Ohne Warnung</span>
            </div>
          </a>

          <a href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Setup-1.0.2.exe" className="btn-hero-secondary" download>
            <Download size={18} />
            <span>Direkt-Installer (.exe)</span>
          </a>
        </div>

        <div className="hero-highlights">
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>1-Klick Installer</span>
          </div>
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>Automatische Updates</span>
          </div>
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>Keine Telefonnummer nötig</span>
          </div>
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>2FA-gesichert</span>
          </div>
        </div>

        {/* ── App Mockup Preview ──────────────────────────────────────────────── */}
        <div className="mockup-preview-window">
          <div className="mockup-window-header">
            <div className="mockup-window-dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <div className="mockup-window-title">
              Mingle — #allgemein (Offizieller Community Server)
            </div>
          </div>

          <div className="mockup-window-body">
            {/* Server Sidebar */}
            <div className="mockup-servers-bar">
              <div className="mockup-server-icon active">M</div>
              <div className="mockup-server-icon">🎮</div>
              <div className="mockup-server-icon">💬</div>
              <div className="mockup-server-icon plus">+</div>
            </div>

            {/* Channels Sidebar */}
            <div className="mockup-channels-bar">
              <div className="mockup-server-name">
                <b>Community Server</b>
                <Crown size={14} className="crown-icon" />
              </div>

              <div className="mockup-channel-item active">
                <Hash size={14} /> allgemein
              </div>
              <div className="mockup-channel-item">
                <Hash size={14} /> ankündigungen
              </div>
              <div className="mockup-channel-item">
                <Hash size={14} /> gaming
              </div>
              <div className="mockup-channel-item">
                <Hash size={14} /> hilfe-support
              </div>
            </div>

            {/* Chat Area */}
            <div className="mockup-chat-area">
              <div className="mockup-chat-header">
                <Hash size={16} /> <b>allgemein</b> — Willkommen im offiziellen Community Server!
              </div>

              <div className="mockup-messages-list">
                <div className="mockup-message">
                  <span className="mockup-msg-avatar owner">O</span>
                  <div>
                    <div className="mockup-msg-author">
                      <span className="author-name">Owner</span>
                      <span className="role-tag owner-tag">OWNER</span>
                      <small>Heute um 14:10</small>
                    </div>
                    <p className="author-body">Willkommen bei Mingle! Der Server läuft stabil in der Cloud und die Auto-Updates sind scharf geschaltet. 🚀</p>
                  </div>
                </div>

                <div className="mockup-message">
                  <span className="mockup-msg-avatar admin">A</span>
                  <div>
                    <div className="mockup-msg-author">
                      <span className="author-name">Alex_Mod</span>
                      <span className="role-tag admin-tag">ADMIN</span>
                      <small>Heute um 14:12</small>
                    </div>
                    <p className="author-body">2-Faktor-Authentifizierung aktiviert und Rollen sind verteilt. Alles läuft flüssig und stabil!</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Features Section ──────────────────────────────────────────────────── */}
      <section id="features" className="landing-section">
        <div className="section-header">
          <span className="section-kicker">COMMUNITY MESSENGER</span>
          <h2>Alles, was du für deine Community brauchst</h2>
          <p>Von flexiblen Rollen bis hin zu verschlüsselten privaten Chats und Videoanrufen.</p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon-box purple">
              <Crown size={24} />
            </div>
            <h3>Rollen &amp; Rechte-System</h3>
            <p>
              Strikte Hierarchien für deine Community: <b>Owner</b>, <b>Admin</b>, <b>Moderator</b>, <b>Staff</b> und <b>Member</b>.
              Der Owner hat volle Kontrolle über Banns, Kicks und Rollenverteilung.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box blue">
              <Hash size={24} />
            </div>
            <h3>Server &amp; Textkanäle</h3>
            <p>
              Erstelle eigene Server mit individuellem Icon und erstelle strukturierte Channels
              wie <code>#allgemein</code> oder <code>#gaming</code> für getrennte Themen.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box green">
              <ShieldCheck size={24} />
            </div>
            <h3>E-Mail-Schutz &amp; 2FA</h3>
            <p>
              Konto-Aktivierung erfolgt per E-Mail-Bestätigung.
              Sensible Änderungen an Passwort, Benutzername oder E-Mail werden per 2FA Authenticator-Code abgesichert.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box orange">
              <Monitor size={24} />
            </div>
            <h3>Auto-Update Technologie</h3>
            <p>
              Sobald eine neue Mingle-Version veröffentlicht wird, erkennt die Windows-Desktop-App
              dies automatisch beim Start und aktualisiert sich nahtlos im Hintergrund.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box pink">
              <Flame size={24} />
            </div>
            <h3>Live-Status &amp; Profile</h3>
            <p>
              Signalisiere deinen Freunden sofort, ob du da bist:
              🟢 <b>Online</b>, 🟡 <b>Abwesend</b>, 🔴 <b>Beschäftigt (DND)</b> oder ⚪ <b>Offline</b>.
              Personalisiere dein Profil mit Avatar und Banner.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box mint">
              <Lock size={24} />
            </div>
            <h3>Freundschaftsanfragen</h3>
            <p>
              Erhalte Freundschafts- und Nachrichtenanfragen, nimm sie an oder lehne sie ab.
              Blockiere unerwünschte Nutzer mit einem einzigen Klick.
            </p>
          </div>
        </div>
      </section>

      {/* ── Auto-Update Showcase ──────────────────────────────────────────────── */}
      <section id="download" className="landing-section download-cta-section">
        <div className="download-box">
          <div className="download-box-content">
            <span className="download-kicker">WINDOWS DESKTOP</span>
            <h2>Hol dir Mingle für deinen PC</h2>
            <p>
              Installiere die App mit 1 Klick. Keine Konsole, keine manuellen Downloads bei Updates –
              Mingle hält sich von selbst auf dem allerneuesten Stand.
            </p>
            <div className="download-actions">
              <a href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Windows-1.0.2.zip" className="btn-hero-primary" download>
                <Download size={22} />
                <div className="btn-text-block">
                  <span className="btn-main-label">Download als .ZIP (Empfohlen)</span>
                  <span className="btn-sub-label">Ohne Browser-Sicherheitswarnung</span>
                </div>
              </a>
              <a href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Setup-1.0.2.exe" className="btn-hero-secondary" download>
                <Download size={18} />
                <span>Direkt als .EXE laden</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="footer-brand">
            <MessageSquare size={18} />
            <span>mingle.</span>
          </div>
          <div className="footer-copy">
            © 2026 Mingle Messenger • Dein privater Raum für echte Verbindungen.
          </div>
        </div>
      </footer>
    </div>
  );
}
