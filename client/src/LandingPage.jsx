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
  Hash,
  Send,
  Smile,
  Paperclip,
  Volume2,
  Mic,
  Headphones,
  Settings,
  Plus,
  Compass,
  Check
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
      .catch(() => {});
  }, []);

  return (
    <div className="landing-container">
      {/* ── Background Ambient Glow ────────────────────────────────────────────── */}
      <div className="landing-ambient-bg" />

      {/* ── Navigation ────────────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <span className="brand-logo-glow">
              <img src="/favicon.png" alt="mingle" style={{ width: 28, height: 28, borderRadius: 8, display: 'block' }} />
            </span>
            <span className="brand-title">mingle<span>.</span></span>
          </div>

          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#mockup">Vorschau</a>
            <a href="#security">Sicherheit</a>
            <a href="#download">Download</a>
          </div>

          <div className="landing-nav-actions">
            <button className="button-nav-login" onClick={onOpenLogin}>
              Anmelden
            </button>
            <button className="button-nav-app" onClick={onOpenApp}>
              <span>Im Browser chatten</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ──────────────────────────────────────────────────────── */}
      <header className="landing-hero">
        <div className="hero-glow-sphere" />

        <div className="hero-badge">
          <Sparkles size={15} className="badge-sparkle" />
          <span>Mingle v{releaseInfo.version} • Der moderne Community Messenger</span>
        </div>

        <h1 className="hero-heading">
          Dein Raum für <span className="text-gradient">echte Gespräche</span><br />
          &amp; lebendige Communities.
        </h1>

        <p className="hero-subtext">
          Erstelle eigene Server mit Text- &amp; Sprachkanälen, verteile differenzierte Rollen von Owner bis Moderator,
          schütze dein Konto mit 2FA und chatte in Echtzeit. Als Windows-App mit automatischen Updates oder direkt im Web-Browser.
        </p>

        <div className="hero-actions">
          <button className="btn-hero-web" onClick={onOpenApp}>
            <MessageSquare size={20} />
            <div className="btn-text-block">
              <span className="btn-main-label">Im Browser öffnen</span>
              <span className="btn-sub-label">Keine Installation nötig</span>
            </div>
            <ArrowRight size={18} />
          </button>

          <a
            href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Windows-1.0.2.zip"
            className="btn-hero-primary"
            download
          >
            <Download size={20} />
            <div className="btn-text-block">
              <span className="btn-main-label">Download für Windows (.zip)</span>
              <span className="btn-sub-label">Empfohlen • Ohne SmartScreen-Warnung</span>
            </div>
          </a>

          <a
            href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Setup-1.0.2.exe"
            className="btn-hero-secondary"
            download
          >
            <Download size={18} />
            <span>Direkt-Installer (.exe)</span>
          </a>
        </div>

        <div className="hero-highlights">
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>1-Klick Installer</span>
          </div>
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>Automatische Hintergrund-Updates</span>
          </div>
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>Keine Telefonnummer nötig</span>
          </div>
          <div className="highlight-item">
            <CheckCircle2 size={16} /> <span>2FA &amp; Ende-zu-Ende Schutz</span>
          </div>
        </div>

        {/* ── App Mockup Preview (Discord-Style Real UI) ────────────────────── */}
        <div id="mockup" className="mockup-preview-wrapper">
          <div className="mockup-glow-back" />
          <div className="mockup-preview-window">
            {/* Window title bar */}
            <div className="mockup-window-header">
              <div className="mockup-window-dots">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>
              <div className="mockup-window-title">
                <MessageSquare size={13} />
                <span>Mingle Desktop — Offizieller Community Server</span>
              </div>
              <div className="mockup-window-badge">v{releaseInfo.version} Online</div>
            </div>

            {/* Window Body: Rail + Channels + Chat + Memberlist */}
            <div className="mockup-window-body">
              {/* 1. Server Rail */}
              <div className="mockup-servers-bar">
                <div className="mockup-server-icon active" title="Offizieller Server">
                  <div className="active-pill" />
                  <span>M</span>
                </div>
                <div className="mockup-server-icon" title="Gaming Lounge">
                  <span>🎮</span>
                </div>
                <div className="mockup-server-icon" title="Entwickler Chat">
                  <span>💻</span>
                </div>
                <div className="mockup-server-icon plus" title="Server hinzufügen">
                  <Plus size={18} />
                </div>
                <div className="mockup-server-icon compass" title="Entdecken">
                  <Compass size={18} />
                </div>
              </div>

              {/* 2. Channels Sidebar */}
              <div className="mockup-channels-bar">
                <div className="mockup-server-header">
                  <span className="mockup-server-title">Community Server</span>
                  <Crown size={15} className="crown-icon" />
                </div>

                <div className="mockup-channel-category">TEXTKANÄLE</div>

                <div className="mockup-channel-item active">
                  <Hash size={15} />
                  <span>allgemein</span>
                </div>
                <div className="mockup-channel-item">
                  <Hash size={15} />
                  <span>ankündigungen</span>
                </div>
                <div className="mockup-channel-item">
                  <Hash size={15} />
                  <span>gaming</span>
                </div>
                <div className="mockup-channel-item">
                  <Hash size={15} />
                  <span>hilfe-support</span>
                </div>

                <div className="mockup-channel-category">SPRACHKANÄLE</div>

                <div className="mockup-channel-item">
                  <Volume2 size={15} />
                  <span>Lounge</span>
                  <span className="voice-count">3</span>
                </div>

                {/* User bar at bottom */}
                <div className="mockup-user-bar">
                  <div className="mockup-user-avatar">
                    <span>Du</span>
                    <span className="user-dot-online" />
                  </div>
                  <div className="mockup-user-details">
                    <span className="mockup-user-name">DeinName</span>
                    <span className="mockup-user-status">#0001</span>
                  </div>
                  <div className="mockup-user-controls">
                    <Mic size={14} />
                    <Headphones size={14} />
                    <Settings size={14} />
                  </div>
                </div>
              </div>

              {/* 3. Main Chat View */}
              <div className="mockup-chat-area">
                <div className="mockup-chat-header">
                  <div className="mockup-channel-name">
                    <Hash size={18} />
                    <b>allgemein</b>
                  </div>
                  <span className="mockup-header-topic">
                    Der zentrale Raum für Neuigkeiten, Diskussionen und Spaß!
                  </span>
                </div>

                <div className="mockup-messages-list">
                  {/* Msg 1 */}
                  <div className="mockup-message">
                    <div className="mockup-msg-avatar owner">O</div>
                    <div className="mockup-msg-content">
                      <div className="mockup-msg-author">
                        <span className="author-name">Owner</span>
                        <span className="role-tag owner-tag">OWNER</span>
                        <small>Heute um 14:10</small>
                      </div>
                      <p className="author-body">
                        Willkommen bei Mingle! Der Server läuft stabil in der Cloud und die Auto-Updates sind scharf geschaltet. 🚀
                      </p>
                    </div>
                  </div>

                  {/* Msg 2 */}
                  <div className="mockup-message">
                    <div className="mockup-msg-avatar admin">A</div>
                    <div className="mockup-msg-content">
                      <div className="mockup-msg-author">
                        <span className="author-name">Alex_Mod</span>
                        <span className="role-tag admin-tag">ADMIN</span>
                        <small>Heute um 14:12</small>
                      </div>
                      <p className="author-body">
                        2-Faktor-Authentifizierung ist aktiv und die Berechtigungen für Moderatoren sind fertig konfiguriert. Alles läuft absolut flüssig! 🔥
                      </p>
                    </div>
                  </div>

                  {/* Msg 3 */}
                  <div className="mockup-message">
                    <div className="mockup-msg-avatar member">L</div>
                    <div className="mockup-msg-content">
                      <div className="mockup-msg-author">
                        <span className="author-name">Lisa</span>
                        <span className="role-tag member-tag">MEMBER</span>
                        <small>Heute um 14:15</small>
                      </div>
                      <p className="author-body">
                        Die neue Oberfläche sieht genial aus! Endlich ein moderner Messenger ohne nervige Werbung oder Bloatware. 🙌
                      </p>
                    </div>
                  </div>
                </div>

                {/* Input row */}
                <div className="mockup-input-box">
                  <Paperclip size={18} className="input-icon" />
                  <span className="input-placeholder">Nachricht an #allgemein schreiben ...</span>
                  <div className="input-actions">
                    <Smile size={18} className="input-icon" />
                    <button className="input-send-btn">
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 4. Member List Sidebar */}
              <div className="mockup-members-bar">
                <div className="mockup-member-group">ONLINE — 3</div>
                <div className="mockup-member-item">
                  <div className="member-avatar owner">
                    <span>O</span>
                    <i className="online-dot" />
                  </div>
                  <div className="member-info">
                    <span className="member-name">Owner</span>
                    <span className="member-sub">Serverleiter</span>
                  </div>
                </div>

                <div className="mockup-member-item">
                  <div className="member-avatar admin">
                    <span>A</span>
                    <i className="online-dot" />
                  </div>
                  <div className="member-info">
                    <span className="member-name">Alex_Mod</span>
                    <span className="member-sub">Moderator</span>
                  </div>
                </div>

                <div className="mockup-member-item">
                  <div className="member-avatar member">
                    <span>L</span>
                    <i className="online-dot" />
                  </div>
                  <div className="member-info">
                    <span className="member-name">Lisa</span>
                    <span className="member-sub">Chilling</span>
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
              Der Serverleiter hat volle Kontrolle über Banns, Kicks und Rollenverteilung.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box blue">
              <Hash size={24} />
            </div>
            <h3>Server &amp; Textkanäle</h3>
            <p>
              Erstelle eigene Server mit individuellem Icon und erstelle strukturierte Channels
              wie <code>#allgemein</code> oder <code>#gaming</code> für geordnete Gesprächsthemen.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box green">
              <ShieldCheck size={24} />
            </div>
            <h3>E-Mail-Schutz &amp; 2FA</h3>
            <p>
              Konto-Aktivierung erfolgt sicher per Bestätigungslink.
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
              Personalisiere dein Profil mit Avatar und eigenem Status.
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

      {/* ── Auto-Update Showcase & Download CTA ───────────────────────────────── */}
      <section id="download" className="landing-section download-cta-section">
        <div className="download-box">
          <div className="download-box-content">
            <span className="download-kicker">WINDOWS DESKTOP &amp; WEB</span>
            <h2>Hol dir Mingle für deinen Alltag</h2>
            <p>
              Installiere die App mit 1 Klick auf Windows oder nutze sie direkt im Webbrowser.
              Keine Konsole, keine manuellen Update-Downloads – Mingle hält sich von selbst aktuell.
            </p>
            <div className="download-actions">
              <button className="btn-box-browser" onClick={onOpenApp}>
                <MessageSquare size={20} />
                <span>Web-App starten</span>
              </button>
              <a
                href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Windows-1.0.2.zip"
                className="btn-hero-primary"
                download
              >
                <Download size={20} />
                <div className="btn-text-block">
                  <span className="btn-main-label">Download .ZIP (Empfohlen)</span>
                  <span className="btn-sub-label">Ohne Browser-Warnung</span>
                </div>
              </a>
              <a
                href="https://github.com/timrex011/mingle-messenger/releases/download/v1.0.2/Mingle-Setup-1.0.2.exe"
                className="btn-hero-secondary"
                download
              >
                <Download size={18} />
                <span>Direkt-Setup (.exe)</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="footer-brand">
            <MessageSquare size={20} className="brand-icon" />
            <span>mingle.</span>
          </div>
          <div className="footer-links">
            <a href="#features">Features</a>
            <a href="#download">Download</a>
            <button className="footer-link-btn" onClick={onOpenLogin}>Anmelden</button>
            <button className="footer-link-btn" onClick={onOpenRegister}>Registrieren</button>
          </div>
          <div className="footer-copy">
            © 2026 Mingle Messenger • Dein privater Raum für echte Verbindungen.
          </div>
        </div>
      </footer>
    </div>
  );
}
