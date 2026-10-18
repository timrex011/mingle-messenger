import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Copy,
  Crown,
  Download,
  FileText,
  Hash,
  LockKeyhole,
  Link2,
  LogOut,
  Menu,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Moon,
  MoreHorizontal,
  Paperclip,
  Phone,
  PhoneOff,
  Plus,
  Search,
  Send,
  Settings,
  Settings2,
  ShieldCheck,
  SmilePlus,
  Sun,
  Trash2,
  UserRound,
  UserRoundCog,
  UserPlus,
  UserX,
  Volume2,
  UsersRound,
  Video,
  VideoOff,
  X
} from 'lucide-react';
import { request, requestBlob } from './api';
import LandingPage from './LandingPage';

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <img src="/favicon.svg" alt="Mingle" className="brand-mark brand-img-mark" />
      {!compact && <span className="brand-name">mingle<span>.</span></span>}
    </div>
  );
}

function Avatar({ name = '?', online = false, size = 'normal' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return (
    <span className={`avatar avatar-${size}`}>
      {initials}
      {online && <i className="online-dot" />}
    </span>
  );
}

const SERVER_PERMISSION_LABELS = [
  ['read_messages', 'Kanäle ansehen'],
  ['send_messages', 'Nachrichten senden'],
  ['manage_channels', 'Kanäle verwalten'],
  ['manage_roles', 'Rollen verwalten'],
  ['manage_invites', 'Einladungen verwalten'],
  ['kick_members', 'Mitglieder entfernen'],
  ['manage_server', 'Server verwalten']
];

function MessageAttachment({ attachment, token, onToken }) {
  const [url, setUrl] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const attachmentRef = useRef(null);
  const isImage = attachment.mimeType.startsWith('image/');
  const isVideo = attachment.mimeType.startsWith('video/');
  const isPreviewable = isImage || isVideo;
  const sizeLabel = attachment.size < 1024 * 1024
    ? `${Math.max(1, Math.round(attachment.size / 1024))} KB`
    : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`;

  useEffect(() => {
    if (!isPreviewable) return undefined;
    let active = true;
    let objectUrl = '';
    let requested = false;
    function loadImage() {
      if (requested) return;
      requested = true;
      setLoading(true);
      requestBlob(attachment.url, { token, onToken })
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          if (active) setUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        })
        .catch((error) => {
          if (active) setLoadError(error.message);
        })
        .finally(() => { if (active) setLoading(false); });
    }
    if (!('IntersectionObserver' in window)) {
      loadImage();
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadImage();
      }
    }, { rootMargin: '160px' });
    if (attachmentRef.current) observer.observe(attachmentRef.current);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, attachment.url, isPreviewable, token, onToken]);

  if (isPreviewable) {
    if (loadError) return <p className="attachment-error">{loadError}</p>;
    const preview = <span className="attachment-image-preview" ref={attachmentRef}>
      {url
        ? isImage
          ? <img className="attachment-image" src={url} alt={attachment.name} />
          : <video className="attachment-video" src={url} controls preload="metadata" aria-label={attachment.name} />
        : <span>{loading ? (isVideo ? 'Video wird geladen …' : 'Bild wird geladen …') : (isVideo ? 'Videovorschau' : 'Bildvorschau')}</span>}
    </span>;
    const details = <span>{attachment.name} <small>{sizeLabel}</small></span>;
    return isImage
      ? <a className="attachment-image-link" href={url} target="_blank" rel="noreferrer">{preview}{details}</a>
      : <div className="attachment-image-link">{preview}{details}</div>;
  }
  async function downloadAttachment() {
    setLoading(true);
    setLoadError('');
    try {
      const blob = await requestBlob(attachment.url, { token, onToken });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }
  return <div className="attachment-file-wrap">
    <button className="attachment-file" type="button" onClick={downloadAttachment} disabled={loading}>
      <span className="attachment-file-icon"><FileText size={18} /></span>
      <span><b>{attachment.name}</b><small>{loading ? 'Wird geladen …' : sizeLabel}</small></span>
      <Download size={15} />
    </button>
    {loadError && <p className="attachment-error">{loadError}</p>}
  </div>;
}

function getClientDeviceInfo() {
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('mingle_device_id') || '';
    if (!deviceId) {
      deviceId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'dev_' + Math.random().toString(36).slice(2) + Date.now();
      localStorage.setItem('mingle_device_id', deviceId);
    }
  } catch {
    deviceId = 'web_' + Date.now();
  }

  let deviceName = 'Web Browser';
  try {
    const ua = navigator.userAgent;
    let os = 'Unbekanntes System';
    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    let browser = 'Browser';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';

    if (window.electronAPI) {
      deviceName = `${os} (Mingle Desktop App)`;
    } else {
      deviceName = `${browser} auf ${os}`;
    }
  } catch {}

  return { deviceId, deviceName };
}

function AuthPage({ onSession, initialMode = 'login', onBackToLanding }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ email: '', password: '', username: '', age: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [canResendVerification, setCanResendVerification] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [twoFactor, setTwoFactor] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [emailCode, setEmailCode] = useState('');

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError('');
    setCanResendVerification(false);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setCanResendVerification(false);
    const { deviceId, deviceName } = getClientDeviceInfo();
    try {
      if (verificationRequired) {
        const result = await request('/auth/verify-email', {
          method: 'POST',
          body: { email: form.email, code: verificationCode }
        });
        setVerificationRequired(false);
        setVerificationCode('');
        setMode('login');
        setNotice(result.message);
      } else if (mode === 'register') {
        const result = await request('/auth/register', {
          method: 'POST',
          body: { email: form.email, password: form.password, username: form.username, age: Number(form.age) }
        });
        setNotice(result.message);
        setVerificationRequired(Boolean(result.verificationRequired));
      } else if (mode === 'forgot') {
        const result = await request('/auth/forgot-password', { method: 'POST', body: { email: form.email } });
        setNotice(result.message);
      } else {
        const result = await request('/auth/login', {
          method: 'POST',
          body: { identifier: form.email, password: form.password, deviceId, deviceName }
        });
        if (result.emailCodeRequired) {
          setTwoFactor({
            challengeToken: result.challengeToken,
            twoFactorRequired: result.twoFactorRequired
          });
          setTotpCode('');
          setEmailCode('');
          setError('');
        } else {
          onSession(result);
        }
      }
    } catch (requestError) {
      setError(requestError.message);
      setCanResendVerification(requestError.message.includes('Bitte bestätige zuerst'));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request('/auth/resend-verification', {
        method: 'POST',
        body: { email: form.email }
      });
      setNotice(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { deviceId, deviceName } = getClientDeviceInfo();
    try {
      const result = await request('/auth/2fa/verify', {
        method: 'POST',
        body: {
          challengeToken: twoFactor.challengeToken,
          emailCode,
          ...(twoFactor.twoFactorRequired ? { totpCode } : {}),
          deviceId,
          deviceName
        }
      });
      onSession(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === 'register' && !verificationRequired;
  const isForgot = mode === 'forgot';

  if (twoFactor) {
    return (
      <main className="auth-page">
        <section className="auth-art">
          <div className="auth-art-top"><Brand /></div>
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-card card-back"><span className="mini-avatar coral">M</span><span className="card-line long" /><span className="card-line short" /></div>
          <div className="art-card card-front">
            <div className="art-chat-head"><span className="mini-avatar blue">L</span><div><b>Lea</b><small>gerade online</small></div><span className="online-dot static" /></div>
            <div className="art-bubble incoming">Bin gleich da! <small>14:32</small></div>
            <div className="art-bubble outgoing">Perfekt, bis gleich ✨ <small>14:33　✓✓</small></div>
            <div className="art-input"><span>Nachricht schreiben …</span><i><Send size={14} /></i></div>
          </div>
          <div className="art-copy">
            <span className="eyebrow">DEIN PLATZ FÜR GUTE GESPRÄCHE</span>
            <h1>In Verbindung.<br /><em>Ganz bei dir.</em></h1>
            <p>Teile Momente, Gedanken und alles dazwischen — einfach und sicher.</p>
            <div className="art-trust"><ShieldCheck size={17} /> Privat. Sicher. Ohne Telefonnummer.</div>
          </div>
          <div className="art-footer"><span>© 2026 mingle</span><span>Mit Ruhe verbunden</span></div>
        </section>
        <section className="auth-panel">
          <div className="mobile-brand"><Brand /></div>
          <div className="auth-content">
            <div className="auth-heading">
              <span className="auth-kicker">ZWEI-FAKTOR-AUTHENTIFIZIERUNG</span>
              <h2>Login bestätigen</h2>
              <p>Gib den Code aus deinem E-Mail-Postfach ein{twoFactor.twoFactorRequired ? ' und bestätige zusätzlich mit deiner Authenticator-App.' : '.'}</p>
            </div>
            <form className="auth-form" onSubmit={verifyTotp}>
              <label className="field">
                <span>E-Mail-Code</span>
                <div className="input-wrap"><ShieldCheck size={17} /><input name="emailCode" value={emailCode} onChange={(e) => { setEmailCode(e.target.value); setError(''); }} placeholder="000000" maxLength="6" autoComplete="one-time-code" inputMode="numeric" autoFocus required /></div>
              </label>
              {twoFactor.twoFactorRequired && <label className="field">
                <span>Authenticator-Code</span>
                <div className="input-wrap"><ShieldCheck size={17} /><input name="totpCode" value={totpCode} onChange={(e) => { setTotpCode(e.target.value); setError(''); }} placeholder="000 000" maxLength="7" autoComplete="one-time-code" inputMode="numeric" required /></div>
              </label>}
              {error && <div className="form-message error" role="alert">{error}</div>}
              <button className="button button-primary auth-submit" type="submit" disabled={busy}>
                {busy ? 'Wird überprüft …' : 'Bestätigen'}
                {!busy && <ArrowRight size={17} />}
              </button>
            </form>
            <div className="auth-links">
              <button className="text-button" onClick={() => { setTwoFactor(null); setError(''); setTotpCode(''); }}><ArrowLeft size={15} /> Zurück zur Anmeldung</button>
            </div>
            <div className="auth-assurance"><ShieldCheck size={16} /><span>Der E-Mail-Code ist 10 Minuten gültig.</span></div>
          </div>
          <div className="auth-panel-footer"><button><CircleHelp size={15} /> Hilfe &amp; Datenschutz</button><span>Deutsch <ChevronDown size={13} /></span></div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-art">
        <div className="auth-art-top"><Brand /></div>
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="art-card card-back"><span className="mini-avatar coral">M</span><span className="card-line long" /><span className="card-line short" /></div>
        <div className="art-card card-front">
          <div className="art-chat-head"><span className="mini-avatar blue">L</span><div><b>Lea</b><small>gerade online</small></div><span className="online-dot static" /></div>
          <div className="art-bubble incoming">Bin gleich da! <small>14:32</small></div>
          <div className="art-bubble outgoing">Perfekt, bis gleich ✨ <small>14:33　✓✓</small></div>
          <div className="art-input"><span>Nachricht schreiben …</span><i><Send size={14} /></i></div>
        </div>
        <div className="art-copy">
          <span className="eyebrow">DEIN PLATZ FÜR GUTE GESPRÄCHE</span>
          <h1>In Verbindung.<br /><em>Ganz bei dir.</em></h1>
          <p>Teile Momente, Gedanken und alles dazwischen — einfach und sicher.</p>
          <div className="art-trust"><ShieldCheck size={17} /> Privat. Sicher. Ohne Telefonnummer.</div>
        </div>
        <div className="art-footer"><span>© 2026 mingle</span><span>Mit Ruhe verbunden</span></div>
      </section>

      <section className="auth-panel">
        <div className="mobile-brand"><Brand /></div>
        <div className="auth-content">
          <div className="auth-heading">
            <span className="auth-kicker">{verificationRequired ? 'KONTOBESTÄTIGUNG' : isRegister ? 'SCHÖN, DASS DU DA BIST' : isForgot ? 'KEIN PROBLEM' : 'WILLKOMMEN ZURÜCK'}</span>
            <h2>{verificationRequired ? 'E-Mail bestätigen' : isRegister ? 'Dein Konto. Dein Raum.' : isForgot ? 'Passwort zurücksetzen' : 'Melde dich an.'}</h2>
            <p>{verificationRequired ? 'Gib den 6-stelligen Bestätigungscode aus deinem Postfach ein.' : isRegister ? 'Ein paar Angaben, dann kann es losgehen.' : isForgot ? 'Wir schicken dir einen Link zum Zurücksetzen.' : 'Deine Gespräche warten schon auf dich.'}</p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {verificationRequired && <label className="field">
              <span>Bestätigungscode</span>
              <div className="input-wrap"><ShieldCheck size={17} /><input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="000000" maxLength="6" inputMode="numeric" autoComplete="one-time-code" required /></div>
            </label>}
            {isRegister && (
              <label className="field">
                <span>Benutzername</span>
                <div className="input-wrap"><UserRound size={17} /><input name="username" value={form.username} onChange={update} placeholder="z. B. alex_7" minLength="3" maxLength="20" autoComplete="username" required /></div>
                <small>3–20 Zeichen, Buchstaben, Zahlen oder _</small>
              </label>
            )}
            {!verificationRequired && <label className="field">
              <span>{isRegister || isForgot ? 'E-Mail-Adresse' : 'E-Mail oder Benutzername'}</span>
              <div className="input-wrap"><span className="input-at">@</span><input name="email" value={form.email} onChange={update} placeholder={isRegister || isForgot ? 'du@beispiel.de' : 'Dein Login'} autoComplete="username" required /></div>
            </label>}
            {!verificationRequired && !isForgot && (
              <label className="field">
                <span>{isRegister ? 'Passwort' : 'Passwort'}</span>
                <div className="input-wrap"><LockKeyhole size={17} /><input name="password" type="password" value={form.password} onChange={update} placeholder="Mindestens 8 Zeichen" minLength="8" maxLength="128" autoComplete={isRegister ? 'new-password' : 'current-password'} required /></div>
              </label>
            )}
            {isRegister && (
              <label className="field">
                <span>Alter</span>
                <div className="input-wrap"><UsersRound size={17} /><input name="age" type="number" value={form.age} onChange={update} placeholder="Mindestens 13 Jahre" min="13" max="120" required /></div>
                <small>Du musst mindestens 13 Jahre alt sein.</small>
              </label>
            )}

            {error && <div className="form-message error" role="alert">{error}</div>}
            {notice && <div className="form-message success" role="status">{notice}</div>}
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Einen Moment …' : verificationRequired ? 'E-Mail bestätigen' : isRegister ? 'Konto erstellen' : isForgot ? 'Link anfordern' : 'Anmelden'}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          {(canResendVerification || verificationRequired) && <button
            className="text-button resend-verification"
            type="button"
            disabled={busy}
            onClick={resendVerification}
          >{busy ? 'Wird versendet …' : 'Bestätigungscode erneut senden'}</button>}

          <div className="auth-links">
            {!verificationRequired && mode === 'login' && <button className="text-button" type="button" onClick={() => { setMode('forgot'); setNotice(''); setError(''); }}>Passwort vergessen?</button>}
            {!verificationRequired && mode === 'forgot' && <button className="text-button" type="button" onClick={() => { setMode('login'); setNotice(''); setError(''); }}><ArrowLeft size={15} /> Zurück zur Anmeldung</button>}
            {!verificationRequired && <div className="auth-switch">
              {isRegister ? 'Schon ein Konto?' : 'Noch kein Konto?'}
              <button className="text-button" onClick={() => { setMode(isRegister ? 'login' : 'register'); setNotice(''); setError(''); }}>
                {isRegister ? 'Anmelden' : 'Jetzt registrieren'}
              </button>
            </div>}
          </div>

          <div className="auth-assurance"><ShieldCheck size={16} /><span>Deine Daten bleiben bei dir. Wir fragen nie nach deiner Telefonnummer.</span></div>
        </div>
        <div className="auth-panel-footer">
          <button><CircleHelp size={15} /> Hilfe & Datenschutz</button>
          <span>Deutsch <ChevronDown size={13} /></span>
        </div>
      </section>
    </main>
  );
}

function VerifyPage({ onBack }) {
  const [status, setStatus] = useState({ kind: 'loading', message: 'Wir bestätigen deine E-Mail-Adresse …' });
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setStatus({ kind: 'error', message: 'Der Bestätigungslink enthält keinen gültigen Token.' });
      return;
    }
    request(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((result) => setStatus({ kind: 'success', message: result.message }))
      .catch((error) => setStatus({ kind: 'error', message: error.message }));
  }, []);

  return (
    <main className="simple-page">
      <div className="simple-card">
        <Brand />
        <div className={`status-icon ${status.kind}`}><ShieldCheck size={28} /></div>
        <span className="auth-kicker">KONTOBESTÄTIGUNG</span>
        <h1>{status.kind === 'success' ? 'Du bist startklar.' : status.kind === 'error' ? 'Das hat nicht geklappt.' : 'Einen Moment …'}</h1>
        <p>{status.message}</p>
        {status.kind !== 'loading' && <button className="button button-primary" onClick={onBack}>Zur Anmeldung <ArrowRight size={17} /></button>}
      </div>
    </main>
  );
}

function ResetPasswordPage({ onBack }) {
  const token = new URLSearchParams(window.location.search).get('token');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      await request('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="simple-page">
      <div className="simple-card">
        <Brand />
        <div className={`status-icon ${done ? 'success' : ''}`}><LockKeyhole size={27} /></div>
        <span className="auth-kicker">SICHERHEIT</span>
        <h1>{done ? 'Passwort geändert.' : 'Neues Passwort'}</h1>
        <p>{done ? 'Du kannst dich jetzt mit deinem neuen Passwort anmelden.' : 'Wähle ein starkes Passwort mit mindestens 8 Zeichen.'}</p>
        {!done && (
          <form className="auth-form" onSubmit={submit}>
            <label className="field"><span>Neues Passwort</span><div className="input-wrap"><LockKeyhole size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="8" maxLength="128" autoComplete="new-password" required /></div></label>
            <label className="field"><span>Passwort wiederholen</span><div className="input-wrap"><LockKeyhole size={17} /><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength="8" maxLength="128" autoComplete="new-password" required /></div></label>
            {error && <div className="form-message error" role="alert">{error}</div>}
            <button className="button button-primary" disabled={busy || !token}>{busy ? 'Wird gespeichert …' : 'Passwort speichern'} <ArrowRight size={17} /></button>
          </form>
        )}
        {(done || !token) && <button className="button button-primary" onClick={onBack}>Zur Anmeldung <ArrowRight size={17} /></button>}
      </div>
    </main>
  );
}

function SettingsPage({
  user,
  token,
  onUserChange,
  onToken,
  onLogout,
  notificationSettings,
  notificationPermission,
  notificationSupported,
  notificationNotice,
  onDesktopNotificationsChange,
  onNotificationSoundChange
}) {
  const [username, setUsername] = useState(user.username);
  const [age, setAge] = useState(String(user.age));
  const [profileTotpCode, setProfileTotpCode] = useState('');
  const [profileChallenge, setProfileChallenge] = useState(null);
  const [profileEmailCode, setProfileEmailCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordTotpCode, setPasswordTotpCode] = useState('');
  const [passwordChallenge, setPasswordChallenge] = useState(null);
  const [passwordEmailCode, setPasswordEmailCode] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailTotpCode, setEmailTotpCode] = useState('');
  const [emailChallenge, setEmailChallenge] = useState(null);
  const [emailVerificationCode, setEmailVerificationCode] = useState('');

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteChallenge, setDeleteChallenge] = useState(null);
  const [deleteEmailCode, setDeleteEmailCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [totpSetup, setTotpSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpEmailCode, setTotpEmailCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableChallenge, setDisableChallenge] = useState(null);
  const [disableEmailCode, setDisableEmailCode] = useState('');

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = { username, age: Number(age) };
      if (user.totpEnabled && username !== user.username) {
        body.totpCode = profileTotpCode;
      }
      const result = await request('/auth/me', {
        method: 'PATCH',
        token,
        onToken,
        body
      });
      if (result.verificationRequired) {
        setProfileChallenge(result.challengeToken);
        setMessage(result.message);
      } else {
        onUserChange(result.user);
        setProfileTotpCode('');
        setMessage('Dein Profil wurde aktualisiert.');
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeEmail(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (emailChallenge) {
        const result = await request('/auth/verify-action', {
          method: 'POST',
          token,
          onToken,
          body: { challengeToken: emailChallenge.token, code: emailVerificationCode }
        });
        if (result.nextStep) {
          setEmailChallenge({ ...emailChallenge, step: result.nextStep });
          setEmailVerificationCode('');
          setMessage(result.message);
        } else {
          if (result.user) onUserChange(result.user);
          setMessage(result.message);
          setEmailChallenge(null);
          setEmailVerificationCode('');
          setNewEmail('');
          setEmailPassword('');
          setEmailTotpCode('');
        }
        return;
      }
      const body = { newEmail, password: emailPassword };
      if (user.totpEnabled) body.totpCode = emailTotpCode;
      const result = await request('/auth/change-email', {
        method: 'POST',
        token,
        onToken,
        body
      });
      setEmailChallenge({ token: result.challengeToken, step: result.step });
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = { currentPassword, newPassword };
      if (user.totpEnabled) {
        body.totpCode = passwordTotpCode;
      }
      const result = await request('/auth/change-password', {
        method: 'POST',
        token,
        onToken,
        body
      });
      setPasswordChallenge(result.challengeToken);
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyProfileChange(event) {
      event.preventDefault();
      setBusy(true); setError(''); setMessage('');
      try {
        const result = await request('/auth/verify-action', {
          method: 'POST', token, onToken,
          body: { challengeToken: profileChallenge, code: profileEmailCode }
        });
        onUserChange(result.user);
        setProfileChallenge(null);
        setProfileEmailCode('');
        setProfileTotpCode('');
        setMessage('Dein Profil wurde aktualisiert.');
      } catch (requestError) { setError(requestError.message); }
      finally { setBusy(false); }
  }

  async function verifyPasswordChange(event) {
      event.preventDefault();
      setBusy(true); setError(''); setMessage('');
      try {
        const result = await request('/auth/verify-action', {
          method: 'POST', token, onToken,
          body: { challengeToken: passwordChallenge, code: passwordEmailCode }
        });
        setMessage(result.message);
        setPasswordChallenge(null);
        setPasswordEmailCode('');
        setCurrentPassword('');
        setNewPassword('');
        setPasswordTotpCode('');
        window.setTimeout(onLogout, 900);
      } catch (requestError) { setError(requestError.message); }
      finally { setBusy(false); }
  }

  async function verifyDisableTwoFactor(event) {
      event.preventDefault();
      setBusy(true); setError(''); setMessage('');
      try {
        if (!disableChallenge) {
          const result = await request('/auth/2fa/disable', {
            method: 'POST', token, onToken, body: { password: disablePassword }
          });
          setDisableChallenge(result.challengeToken);
          setMessage(result.message);
          return;
        }
        const result = await request('/auth/verify-action', {
          method: 'POST', token, onToken,
          body: { challengeToken: disableChallenge, code: disableEmailCode }
        });
        onUserChange(result.user);
        setDisableChallenge(null);
        setDisableEmailCode('');
        setDisablePassword('');
        setMessage(result.message);
      } catch (requestError) { setError(requestError.message); }
      finally { setBusy(false); }
  }

  async function deleteAccount(event) {
    event.preventDefault();
    if (!deleteChallenge && !window.confirm('Dein Konto und deine Profildaten werden dauerhaft gelöscht. Möchtest du fortfahren?')) return;
    setBusy(true);
    setError('');
    try {
      if (!deleteChallenge) {
        const result = await request('/auth/me', { method: 'DELETE', token, onToken, body: { password: deletePassword } });
        setDeleteChallenge(result.challengeToken);
        setMessage(result.message);
      } else {
        await request('/auth/verify-action', {
          method: 'POST', token, onToken,
          body: { challengeToken: deleteChallenge, code: deleteEmailCode }
        });
        onLogout();
      }
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <div className="page-title-row">
        <div><span className="auth-kicker">DEIN KONTO</span><h1>Einstellungen</h1><p>Verwalte dein Profil und deine Sicherheit.</p></div>
        <Avatar name={user.username} size="large" />
      </div>
      {(message || error) && <div className={`form-message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || message}</div>}
      <NotificationSettings
        desktopEnabled={notificationSettings.desktop}
        soundEnabled={notificationSettings.sound}
        permission={notificationPermission}
        supported={notificationSupported}
        notice={notificationNotice}
        onDesktopChange={onDesktopNotificationsChange}
        onSoundChange={onNotificationSoundChange}
      />
      <section className="settings-card">
        <div className="settings-card-title"><span className="settings-icon"><UserRound size={18} /></span><div><h2>Profil &amp; Benutzername</h2><p>Passe deinen Benutzernamen an.</p></div></div>
        <form className="settings-form" onSubmit={profileChallenge ? verifyProfileChange : saveProfile}>
          {!profileChallenge && <label className="field"><span>Aktuelle E-Mail</span><input className="plain-input readonly" value={user.email} readOnly /></label>}
          {!profileChallenge && <div className="settings-fields">
            <label className="field"><span>Benutzername</span><input className="plain-input" value={username} onChange={(event) => setUsername(event.target.value)} minLength="3" maxLength="20" required /></label>
            <label className="field"><span>Alter</span><input className="plain-input" type="number" value={age} onChange={(event) => setAge(event.target.value)} min="13" max="120" required /></label>
          </div>}
          {!profileChallenge && user.totpEnabled && username !== user.username && (
            <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:10,padding:'12px 14px',margin:'10px 0'}}>
              <p style={{fontSize:'0.85rem',fontWeight:700,color:'#818cf8',margin:'0 0 6px',display:'flex',alignItems:'center',gap:6}}>
                <ShieldCheck size={15}/> 2FA-Sicherheitsabfrage für Namensänderung
              </p>
              <label className="field"><span>6-stelliger Authenticator-Code</span><input className="plain-input" value={profileTotpCode} onChange={(e)=>setProfileTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
            </div>
          )}
          {profileChallenge && <label className="field"><span>Sicherheitscode aus der E-Mail</span><input className="plain-input" value={profileEmailCode} onChange={(event) => setProfileEmailCode(event.target.value)} inputMode="numeric" maxLength="6" required /></label>}
          {profileChallenge
            ? <button className="button button-dark" disabled={busy}>Profiländerung bestätigen</button>
            : <button className="button button-dark" disabled={busy}>Änderungen speichern</button>}
        </form>
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><span className="settings-icon blue"><ShieldCheck size={18} /></span><div><h2>E-Mail-Adresse ändern</h2><p>Aktuelle E-Mail: <b>{user.email}</b></p></div></div>
        <form className="settings-form" onSubmit={changeEmail}>
          {!emailChallenge && <label className="field"><span>Neue E-Mail-Adresse</span><input className="plain-input" type="email" value={newEmail} onChange={(e)=>setNewEmail(e.target.value)} placeholder="neu@beispiel.de" required /></label>}
          {!emailChallenge && <label className="field"><span>Aktuelles Passwort bestätigen</span><input className="plain-input" type="password" value={emailPassword} onChange={(e)=>setEmailPassword(e.target.value)} autoComplete="current-password" required /></label>}
          {!emailChallenge && user.totpEnabled && (
            <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:10,padding:'12px 14px',margin:'10px 0'}}>
              <p style={{fontSize:'0.85rem',fontWeight:700,color:'#818cf8',margin:'0 0 6px',display:'flex',alignItems:'center',gap:6}}>
                <ShieldCheck size={15}/> 2FA-Sicherheitsabfrage für E-Mail-Änderung
              </p>
              <label className="field"><span>6-stelliger Authenticator-Code</span><input className="plain-input" value={emailTotpCode} onChange={(e)=>setEmailTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
            </div>
          )}
          {emailChallenge && <label className="field">
            <span>{emailChallenge.step === 'old_email' ? 'Code aus der bisherigen E-Mail-Adresse' : 'Code aus der neuen E-Mail-Adresse'}</span>
            <input className="plain-input" value={emailVerificationCode} onChange={(e)=>setEmailVerificationCode(e.target.value)} placeholder="000000" inputMode="numeric" maxLength="6" required />
          </label>}
          <button className="button button-dark" disabled={busy}>{emailChallenge ? 'Code bestätigen' : 'E-Mail aktualisieren'}</button>
        </form>
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><span className="settings-icon mint"><LockKeyhole size={18} /></span><div><h2>Passwort ändern</h2><p>Wir melden dich nach der Änderung auf allen Geräten ab.</p></div></div>
        <form className="settings-form" onSubmit={passwordChallenge ? verifyPasswordChange : changePassword}>
          {!passwordChallenge && <label className="field"><span>Aktuelles Passwort</span><input className="plain-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>}
          {!passwordChallenge && <label className="field"><span>Neues Passwort</span><input className="plain-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength="8" maxLength="128" autoComplete="new-password" required /></label>}
          {!passwordChallenge && user.totpEnabled && (
            <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:10,padding:'12px 14px',margin:'10px 0'}}>
              <p style={{fontSize:'0.85rem',fontWeight:700,color:'#818cf8',margin:'0 0 6px',display:'flex',alignItems:'center',gap:6}}>
                <ShieldCheck size={15}/> 2FA-Sicherheitsabfrage für Passwortänderung
              </p>
              <label className="field"><span>6-stelliger Authenticator-Code</span><input className="plain-input" value={passwordTotpCode} onChange={(e)=>setPasswordTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
            </div>
          )}
          {passwordChallenge && <label className="field"><span>Sicherheitscode aus der E-Mail</span><input className="plain-input" value={passwordEmailCode} onChange={(event) => setPasswordEmailCode(event.target.value)} inputMode="numeric" maxLength="6" required /></label>}
          <button className="button button-dark" disabled={busy}>{passwordChallenge ? 'Passwortänderung bestätigen' : 'Passwort aktualisieren'}</button>
        </form>
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><span className="settings-icon mint"><ShieldCheck size={18} /></span><div><h2>Zwei-Faktor-Authentifizierung</h2><p>{user.totpEnabled ? '2FA ist aktiv – dein Konto ist extra geschützt.' : 'Schütze dein Konto mit einer Authenticator-App.'}</p></div></div>
        {!user.totpEnabled && !totpSetup && (
          <div className="settings-form">
            <button className="button button-dark" disabled={busy} onClick={async () => {
              setBusy(true); setError(''); setMessage('');
              try {
                const result = await request('/auth/2fa/setup', { method: 'POST', token, onToken });
                setTotpSetup(result);
              } catch (e) { setError(e.message); } finally { setBusy(false); }
            }}>2FA einrichten</button>
          </div>
        )}
        {!user.totpEnabled && totpSetup && (
          <div className="settings-form">
            <p style={{fontSize:'0.92rem',color:'var(--text-muted)',marginBottom:12}}>Scanne den QR-Code mit deiner Authenticator-App (Google Authenticator, Authy, etc.):</p>
            <div style={{textAlign:'center',margin:'12px 0'}}><img src={totpSetup.qrDataUrl} alt="2FA QR-Code" style={{width:200,height:200,borderRadius:12,border:'1px solid var(--border)'}} /></div>
            <p style={{fontSize:'0.8rem',color:'var(--text-muted)',wordBreak:'break-all',textAlign:'center',margin:'0 0 16px'}}>Manueller Schlüssel: <code style={{background:'var(--surface-hover)',padding:'2px 6px',borderRadius:6}}>{totpSetup.secret}</code></p>
            <form onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setError(''); setMessage('');
              try {
                const result = await request('/auth/2fa/enable', {
                  method: 'POST', token, onToken,
                  body: { code: totpCode, emailCode: totpEmailCode, challengeToken: totpSetup.challengeToken }
                });
                setMessage(result.message);
                setTotpSetup(null); setTotpCode(''); setTotpEmailCode('');
                onUserChange(result.user || { ...user, totpEnabled: true });
              } catch (e) { setError(e.message); } finally { setBusy(false); }
            }}>
              <label className="field"><span>6-stelliger Code aus der App</span><input className="plain-input" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
              <label className="field"><span>6-stelliger Sicherheitscode aus deiner E-Mail</span><input className="plain-input" value={totpEmailCode} onChange={(e) => setTotpEmailCode(e.target.value)} placeholder="000000" maxLength="6" inputMode="numeric" autoComplete="one-time-code" required /></label>
              <button className="button button-dark" disabled={busy}>{busy ? 'Wird überprüft …' : '2FA aktivieren'}</button>
            </form>
          </div>
        )}
        {user.totpEnabled && (
          <form className="settings-form" onSubmit={verifyDisableTwoFactor}>
            {!disableChallenge
              ? <label className="field"><span>Passwort bestätigen</span><input className="plain-input" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} autoComplete="current-password" required /></label>
              : <label className="field"><span>Sicherheitscode aus der E-Mail</span><input className="plain-input" value={disableEmailCode} onChange={(e) => setDisableEmailCode(e.target.value)} inputMode="numeric" maxLength="6" required /></label>}
            <button className="button button-danger" disabled={busy}>{disableChallenge ? 'Deaktivierung bestätigen' : '2FA deaktivieren'}</button>
          </form>
        )}
      </section>
      <section className="settings-card danger-card">
        <div className="settings-card-title"><span className="settings-icon rose"><X size={18} /></span><div><h2>Konto löschen</h2><p>Diese Aktion kann nicht rückgängig gemacht werden.</p></div></div>
        <form className="delete-row" onSubmit={deleteAccount}>
          {!deleteChallenge
            ? <label className="field"><span>Mit Passwort bestätigen</span><input className="plain-input" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" required /></label>
            : <label className="field"><span>Sicherheitscode aus der E-Mail</span><input className="plain-input" value={deleteEmailCode} onChange={(event) => setDeleteEmailCode(event.target.value)} inputMode="numeric" maxLength="6" required /></label>}
          <button className="button button-danger" disabled={busy}>{deleteChallenge ? 'Kontolöschung bestätigen' : 'Konto dauerhaft löschen'}</button>
        </form>
      </section>
    </div>
  );
}

function messageTime(value) {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

function NotificationSettings({
  desktopEnabled,
  soundEnabled,
  permission,
  supported,
  notice,
  onDesktopChange,
  onSoundChange
}) {
  const desktopDescription = !supported
    ? 'Desktop-Benachrichtigungen werden in diesem Browser nicht unterstützt.'
    : permission === 'denied'
      ? 'Im Browser blockiert. Ändere die Berechtigung in den Website-Einstellungen.'
      : desktopEnabled
        ? 'Neue Nachrichten erscheinen auch außerhalb des geöffneten Fensters.'
        : 'Nur aktiv, wenn du sie ausdrücklich einschaltest.';

  return (
    <section className="settings-card notification-settings">
      <div className="settings-card-title">
        <span className="settings-icon blue"><BellRing size={18} /></span>
        <div><h2>Benachrichtigungen</h2><p>Bestimme, wie Mingle dich über neue Nachrichten informiert.</p></div>
      </div>
      <div className="notification-options">
        <div className="notification-option">
          <span className="notification-option-icon"><Bell size={17} /></span>
          <span className="notification-option-copy"><b>Desktop-Benachrichtigungen</b><small>{desktopDescription}</small></span>
          <button
            className={`preference-switch ${desktopEnabled ? 'enabled' : ''}`}
            type="button"
            role="switch"
            aria-checked={desktopEnabled}
            aria-label="Desktop-Benachrichtigungen"
            disabled={!supported || permission === 'denied'}
            onClick={onDesktopChange}
          ><i /></button>
        </div>
        <div className="notification-option">
          <span className="notification-option-icon"><Volume2 size={17} /></span>
          <span className="notification-option-copy"><b>Benachrichtigungston</b><small>Ein kurzer, leiser Ton bei neuen Nachrichten, wenn du den Chat gerade nicht offen hast.</small></span>
          <button
            className={`preference-switch ${soundEnabled ? 'enabled' : ''}`}
            type="button"
            role="switch"
            aria-checked={soundEnabled}
            aria-label="Benachrichtigungston"
            onClick={onSoundChange}
          ><i /></button>
        </div>
      </div>
      {notice && <p className="notification-notice" role="status">{notice}</p>}
    </section>
  );
}

function NotificationCenter({ open, unreadCount, items, onToggle, onSelect }) {
  return (
    <div className="notification-anchor">
      <button
        className={`icon-button notification-bell ${open ? 'active' : ''}`}
        type="button"
        aria-label={`Benachrichtigungen${unreadCount ? `, ${unreadCount} ungelesen` : ''}`}
        aria-expanded={open}
        aria-controls="notification-center"
        onClick={onToggle}
      >
        <Bell size={18} />
        {unreadCount > 0 && <i className="notification-total">{unreadCount > 99 ? '99+' : unreadCount}</i>}
      </button>
      {open && <section className="notification-popover" id="notification-center" aria-label="Ungelesene Unterhaltungen">
        <header className="notification-popover-heading">
          <div><b>Benachrichtigungen</b><small>{unreadCount ? `${unreadCount} ungelesen` : 'Alles gelesen'}</small></div>
          <span>{items.length}</span>
        </header>
        <div className="notification-items">
          {items.length === 0
            ? <p className="notification-empty">Hier erscheinen neue Nachrichten aus Chats und Serverkanälen.</p>
            : items.map((item) => (
              <button className="notification-item" type="button" key={`${item.kind}:${item.id}`} onClick={() => onSelect(item)}>
                <span className={`notification-item-mark ${item.kind === 'channel' ? 'channel' : ''}`}>
                  {item.kind === 'channel' ? <Hash size={16} /> : <MessageCircle size={16} />}
                </span>
                <span className="notification-item-copy">
                  <b>{item.kind === 'channel' ? `#${item.name}` : item.name}</b>
                  {item.kind === 'channel' && <small className="notification-server-name">{item.serverName}</small>}
                  <small>{item.lastMessage || 'Neue Nachricht'}</small>
                </span>
                <span className="notification-item-meta">
                  {item.lastMessageAt && <time>{messageTime(item.lastMessageAt)}</time>}
                  <i>{item.unreadCount > 99 ? '99+' : item.unreadCount}</i>
                </span>
              </button>
            ))}
        </div>
      </section>}
    </div>
  );
}

function MessageBubble({ message, mine, token, onToken, onReply, onEdit, onDelete, onReact }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  return (
    <div className={`message-row ${mine ? 'message-mine' : ''}`}>
      {!mine && <Avatar name={message.senderUsername || '?'} size="small" />}
      <div className="message-content">
        {!mine && <span className="message-sender">{message.senderUsername}</span>}
        <div className="message-bubble">
          {message.replyTo && <div className="reply-quote"><b>{message.replyTo.senderUsername || 'Antwort'}</b><span>{message.replyTo.deletedAt ? 'Nachricht gelöscht' : message.replyTo.body}</span></div>}
          {!message.deletedAt && message.attachment && <MessageAttachment attachment={message.attachment} token={token} onToken={onToken} />}
          {message.body && <p>{message.deletedAt ? 'Diese Nachricht wurde gelöscht.' : message.body}</p>}
          {message.deletedAt && <p>Diese Nachricht wurde gelöscht.</p>}
          <div className="message-meta">
            {message.editedAt && <span>bearbeitet</span>}
            <time>{messageTime(message.createdAt)}</time>
            {mine && (message.readCount > 0
              ? <CheckCheck size={14} className="read-check" aria-label={`Gelesen von ${message.readCount} ${message.readCount === 1 ? 'Person' : 'Personen'}`} title={`Gelesen von ${message.readCount} ${message.readCount === 1 ? 'Person' : 'Personen'}`} />
              : <Check size={14} aria-label="Gesendet, noch nicht gelesen" title="Gesendet, noch nicht gelesen" />)}
          </div>
          {message.reactions?.length > 0 && <div className="message-reactions">
            {message.reactions.map((reaction) => <button
              key={reaction.emoji}
              className={`reaction-pill ${reaction.reactedByMe ? 'reacted' : ''}`}
              aria-label={`${reaction.emoji}, ${reaction.count} Reaktionen${reaction.reactedByMe ? ', eigene Reaktion' : ''}`}
              disabled={Boolean(message.deletedAt)}
              onClick={() => onReact(message, reaction.emoji)}
            >{reaction.emoji}<span>{reaction.count}</span></button>)}
          </div>}
        </div>
        <div className="message-actions">
          <button title="Antworten" aria-label="Auf Nachricht antworten" onClick={() => onReply(message)}><ArrowLeft size={14} /></button>
          {!message.deletedAt && <button title="Reagieren" aria-label="Auf Nachricht reagieren" onClick={() => setReactionOpen((open) => !open)}><SmilePlus size={15} /></button>}
          {reactionOpen && <div className="reaction-picker">{REACTION_OPTIONS.map((emoji) => <button
            key={emoji}
            aria-label={`Mit ${emoji} reagieren`}
            onClick={() => { setReactionOpen(false); onReact(message, emoji); }}
          >{emoji}</button>)}</div>}
          <button title="Weitere Aktionen" aria-label="Nachrichtenaktionen" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={15} /></button>
          {menuOpen && (
            <div className="message-menu">
              {mine && !message.deletedAt && <button onClick={() => { setMenuOpen(false); onEdit(message); }}>Bearbeiten</button>}
              {mine && !message.deletedAt && <button onClick={() => { setMenuOpen(false); onDelete(message, 'everyone'); }}>Für alle löschen</button>}
              <button onClick={() => { setMenuOpen(false); onDelete(message, 'me'); }}>Für mich löschen</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatWorkspace({ user, token, onUserChange, onToken, onLogout, theme, onThemeToggle, onOpenInvite, initialServerId, onInitialServerSelected }) {
  const [section, setSection] = useState('chats');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [servers, setServers] = useState([]);
  const [activeServerId, setActiveServerId] = useState(null);
  const [serverDetail, setServerDetail] = useState(null);
  const [serverMembers, setServerMembers] = useState([]);
  const [serverRoles, setServerRoles] = useState([]);
  const [serverInvite, setServerInvite] = useState(null);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [serverMembersOpen, setServerMembersOpen] = useState(true);
  const [serverAdminOpen, setServerAdminOpen] = useState(false);
  const [serverAdminTab, setServerAdminTab] = useState('members');
  const [createServerOpen, setCreateServerOpen] = useState(false);
  const [createServerName, setCreateServerName] = useState('');
  const [createServerIcon, setCreateServerIcon] = useState('');
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createChannelName, setCreateChannelName] = useState('');
  const [roleDraft, setRoleDraft] = useState(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#818cf8');
  const [newRolePermissions, setNewRolePermissions] = useState({ read_messages: true, send_messages: true });
  const [inviteExpiry, setInviteExpiry] = useState('');
  const [inviteMaxUses, setInviteMaxUses] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [friendships, setFriendships] = useState({ incoming: [], outgoing: [], accepted: [] });
  const [blocks, setBlocks] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupDetailsOpen, setGroupDetailsOpen] = useState(false);
  const [groupDetails, setGroupDetails] = useState(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupAddUserId, setGroupAddUserId] = useState('');
  const [typing, setTyping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [notificationSettings, setNotificationSettings] = useState(() => {
    const saved = window.localStorage.getItem(`mingle-notifications:${user.id}`);
    if (!saved) return { desktop: false, sound: false };
    try {
      const parsed = JSON.parse(saved);
      return { desktop: parsed.desktop === true, sound: parsed.sound === true };
    } catch (parseError) {
      if (parseError instanceof SyntaxError) return { desktop: false, sound: false };
      throw parseError;
    }
  });
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  );
  const [notificationNotice, setNotificationNotice] = useState('');
  const [unreadChannels, setUnreadChannels] = useState([]);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [incomingToast, setIncomingToast] = useState(null);
  const notificationSupported = typeof window !== 'undefined' && 'Notification' in window;

  // ── WebRTC State ──
  const [callActive, setCallActive] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callType, setCallType] = useState('audio'); // 'audio', 'video', 'screen'
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callPeerUser, setCallPeerUser] = useState(null);

  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const socketRef = useRef(null);
  const chatSearchRef = useRef(null);
  const selectedIdRef = useRef(null);
  const typingTimer = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeServerIdRef = useRef(null);
  const activeChannelIdRef = useRef(null);
  const activeSectionRef = useRef(section);
  const conversationsRef = useRef(conversations);
  const unreadChannelsRef = useRef(unreadChannels);
  const notificationSettingsRef = useRef(notificationSettings);
  const audioContextRef = useRef(null);
  const toastTimerRef = useRef(null);
  activeSectionRef.current = section;
  conversationsRef.current = conversations;
  unreadChannelsRef.current = unreadChannels;
  notificationSettingsRef.current = notificationSettings;

  const refreshLists = useCallback(async () => {
    const [conversationResult, friendshipResult, blockResult] = await Promise.all([
      request('/conversations', { token, onToken }),
      request('/friendships', { token, onToken }),
      request('/blocks', { token, onToken })
    ]);
    setConversations(conversationResult.conversations);
    setFriendships(friendshipResult);
    setBlocks(blockResult.blocks);
    return conversationResult.conversations;
  }, [token, onToken]);

  const refreshServers = useCallback(async () => {
    const result = await request('/servers', { token, onToken });
    setServers(result.servers || []);
    return result.servers || [];
  }, [token, onToken]);

  const refreshUnreadChannels = useCallback(async () => {
    const result = await request('/servers/notifications/unread', { token, onToken });
    setUnreadChannels(result.channels || []);
    return result.channels || [];
  }, [token, onToken]);

  function playNotificationSound(force = false) {
    if (!force && !notificationSettingsRef.current.sound) return;
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContextConstructor();
    }
    const context = audioContextRef.current;
    context.resume().then(() => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.19);
    }).catch((audioError) => setError(audioError.message));
  }

  async function toggleDesktopNotifications() {
    setNotificationNotice('');
    if (!notificationSupported) {
      setNotificationNotice('Desktop-Benachrichtigungen werden auf diesem Gerät nicht unterstützt.');
      return;
    }
    if (notificationSettings.desktop) {
      setNotificationSettings((current) => ({ ...current, desktop: false }));
      setNotificationNotice('Desktop-Benachrichtigungen sind ausgeschaltet.');
      return;
    }
    if (window.Notification.permission === 'denied') {
      setNotificationPermission('denied');
      setNotificationNotice('Mingle ist in den Browser-Einstellungen blockiert. Erlaube Benachrichtigungen dort und versuche es erneut.');
      return;
    }
    try {
      const permission = window.Notification.permission === 'granted'
        ? 'granted'
        : await window.Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        setNotificationSettings((current) => ({ ...current, desktop: true }));
        setNotificationNotice('Desktop-Benachrichtigungen sind eingeschaltet.');
      } else {
        setNotificationSettings((current) => ({ ...current, desktop: false }));
        setNotificationNotice(permission === 'denied'
          ? 'Benachrichtigungen wurden abgelehnt. Du kannst sie in den Browser-Einstellungen erlauben.'
          : 'Benachrichtigungen wurden nicht freigegeben.');
      }
    } catch (permissionError) {
      setNotificationNotice(`Berechtigung konnte nicht angefragt werden: ${permissionError.message}`);
    }
  }

  function toggleNotificationSound() {
    setNotificationNotice('');
    if (!notificationSettings.sound) {
      setNotificationSettings((current) => ({ ...current, sound: true }));
      playNotificationSound(true);
      setNotificationNotice('Benachrichtigungston ist eingeschaltet.');
    } else {
      setNotificationSettings((current) => ({ ...current, sound: false }));
      setNotificationNotice('Benachrichtigungston ist ausgeschaltet.');
    }
  }

  useEffect(() => {
    window.localStorage.setItem(`mingle-notifications:${user.id}`, JSON.stringify(notificationSettings));
  }, [notificationSettings, user.id]);

  useEffect(() => {
    if ((notificationSupported && notificationPermission === 'denied') || !notificationSupported) {
      if (notificationSettings.desktop) {
        setNotificationSettings((current) => ({ ...current, desktop: false }));
      }
    }
  }, [notificationPermission, notificationSettings.desktop, notificationSupported]);

  useEffect(() => {
    refreshUnreadChannels().catch((requestError) => setError(requestError.message));
  }, [refreshUnreadChannels]);

  useEffect(() => {
    if (!incomingToast) return undefined;
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setIncomingToast(null), 5500);
    return () => window.clearTimeout(toastTimerRef.current);
  }, [incomingToast]);

  useEffect(() => () => {
    window.clearTimeout(toastTimerRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch((audioError) => console.error('Benachrichtigungston konnte nicht beendet werden:', audioError));
    }
  }, []);

  useEffect(() => {
    refreshLists().catch((requestError) => setError(requestError.message));
  }, [refreshLists]);

  useEffect(() => {
    refreshServers().catch((requestError) => setError(requestError.message));
  }, [refreshServers]);

  useEffect(() => {
    const originalTitle = document.title;
    return () => { document.title = originalTitle; };
  }, []);

  useEffect(() => {
    if (initialServerId) {
      selectServer({ id: initialServerId });
      onInitialServerSelected?.();
    }
  }, [initialServerId]);

  useEffect(() => {
    activeServerIdRef.current = activeServerId;
    if (!activeServerId) {
      setServerDetail(null);
      setServerMembers([]);
      setServerRoles([]);
      setServerInvite(null);
      return undefined;
    }
    let current = true;
    setServerDetail(null);
    setServerMembers([]);
    setServerRoles([]);
    setServerInvite(null);
    Promise.all([
      request(`/servers/${activeServerId}`, { token, onToken }),
      request(`/servers/${activeServerId}/members`, { token, onToken })
    ]).then(async ([detailResult, memberResult]) => {
      if (!current || activeServerIdRef.current !== activeServerId) return;
      setServerDetail(detailResult);
      setServerMembers(memberResult.members || []);
      if (!activeChannelIdRef.current && detailResult.channels?.length) {
        selectServerChannel(detailResult.channels[0], activeServerId);
      }
      const permissions = detailResult.server?.myPermissions || {};
      const extras = await Promise.all([
        permissions.manage_roles
          ? request(`/servers/${activeServerId}/roles`, { token, onToken })
          : Promise.resolve({ roles: [] }),
        permissions.manage_invites
          ? request(`/servers/${activeServerId}/invite`, { token, onToken })
          : Promise.resolve({ invite: null })
      ]);
      if (current && activeServerIdRef.current === activeServerId) {
        setServerRoles(extras[0].roles || []);
        setServerInvite(extras[1].invite || null);
      }
    }).catch((requestError) => {
      if (current) setError(requestError.message);
    });
    return () => { current = false; };
  }, [activeServerId, token, onToken]);

  useEffect(() => {
    const socket = io({ path: '/socket.io', auth: { token } });
    socketRef.current = socket;
    let refreshingSocket = false;
    socket.on('connect', () => {
      refreshLists().catch((requestError) => setError(requestError.message));
      refreshUnreadChannels().catch((requestError) => setError(requestError.message));
    });
    socket.on('connect_error', (socketError) => {
      if (!refreshingSocket && /expired|abgelaufen/i.test(socketError.message)) {
        refreshingSocket = true;
        request('/auth/refresh', { method: 'POST' })
          .then((result) => onToken(result.accessToken))
          .catch((requestError) => setError(requestError.message));
        return;
      }
      setError(`Echtzeitverbindung fehlgeschlagen: ${socketError.message}`);
    });
    socket.on('presence:update', (presence) => {
      const updateUser = (items) => items.map((item) => item.user?.id === presence.userId
        ? { ...item, user: { ...item.user, online: presence.online, lastSeenAt: presence.lastSeenAt } }
        : item);
      setFriendships((current) => ({
        ...current,
        incoming: updateUser(current.incoming),
        outgoing: updateUser(current.outgoing),
        accepted: updateUser(current.accepted)
      }));
      setConversations((current) => current.map((conversation) => conversation.peer?.id === presence.userId
        ? { ...conversation, peer: { ...conversation.peer, online: presence.online, lastSeenAt: presence.lastSeenAt } }
        : conversation));
      setResults((current) => current.map((result) => result.id === presence.userId
        ? { ...result, online: presence.online }
        : result));
    });
    socket.on('friendship:update', () => {
      refreshLists().catch((requestError) => setError(requestError.message));
    });
    socket.on('server:joined', () => {
      refreshServers().catch((requestError) => setError(requestError.message));
    });
    socket.on('server:role-updated', ({ serverId }) => {
      refreshServers().catch((requestError) => setError(requestError.message));
      if (activeServerIdRef.current === serverId) {
        request(`/servers/${serverId}`, { token, onToken })
          .then((result) => setServerDetail(result))
          .catch((requestError) => setError(requestError.message));
        request(`/servers/${serverId}/members`, { token, onToken })
          .then((result) => setServerMembers(result.members || []))
          .catch((requestError) => setError(requestError.message));
      }
    });
    socket.on('server:removed', ({ serverId }) => {
      if (activeServerIdRef.current === serverId) {
        setActiveServerId(null);
        activeServerIdRef.current = null;
        setActiveChannelId(null);
        activeChannelIdRef.current = null;
        selectedIdRef.current = null;
        setSelectedId(null);
        setMessages([]);
        setInfo('Du bist nicht mehr Mitglied dieses Servers.');
      }
      refreshServers().catch((requestError) => setError(requestError.message));
    });
    socket.on('conversation:created', () => {
      refreshLists().catch((requestError) => setError(requestError.message));
    });
    socket.on('group:updated', ({ conversationId, name }) => {
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? { ...conversation, name }
        : conversation));
      setGroupDetails((current) => current?.id === conversationId ? { ...current, name } : current);
      setGroupNameDraft((current) => selectedIdRef.current === conversationId ? name : current);
    });
    socket.on('group:member-added', ({ conversationId }) => {
      if (selectedIdRef.current === conversationId) {
        request(`/groups/${conversationId}`, { token, onToken })
          .then((result) => setGroupDetails(result.group))
          .catch((requestError) => setError(requestError.message));
      }
    });
    socket.on('group:role-updated', ({ conversationId }) => {
      if (selectedIdRef.current === conversationId) {
        request(`/groups/${conversationId}`, { token, onToken })
          .then((result) => setGroupDetails(result.group))
          .catch((requestError) => setError(requestError.message));
      }
    });
    socket.on('group:member-removed', ({ conversationId, userId: removedUserId }) => {
      if (removedUserId === user.id) {
        setSelectedId(null);
        selectedIdRef.current = null;
        setGroupDetailsOpen(false);
        setGroupDetails(null);
        setMessages([]);
        refreshLists().catch((requestError) => setError(requestError.message));
        setInfo('Du bist nicht mehr Mitglied dieser Gruppe.');
      } else if (selectedIdRef.current === conversationId) {
        request(`/groups/${conversationId}`, { token, onToken })
          .then((result) => setGroupDetails(result.group))
          .catch((requestError) => setError(requestError.message));
      }
    });
    socket.on('message:new', (message) => {
      const isViewingConversation = activeSectionRef.current === 'chats'
        && selectedIdRef.current === message.conversationId;
      const isIncomingMessage = message.senderId !== user.id;
      setConversations((current) => current.map((conversation) => conversation.id === message.conversationId
        ? {
            ...conversation,
            lastMessage: message.body || (message.attachment ? `📎 ${message.attachment.name}` : ''),
            lastMessageAt: message.createdAt,
            unreadCount: message.senderId === user.id || isViewingConversation
              ? 0
              : conversation.unreadCount + 1
          }
        : conversation));
      if (isViewingConversation) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (isIncomingMessage) {
          request(`/conversations/${message.conversationId}/read`, { method: 'POST', token, onToken })
            .then(() => {
              setUnreadChannels((current) => current.filter((channel) => channel.id !== message.conversationId));
              setServerDetail((current) => current ? {
                ...current,
                channels: current.channels.map((channel) => channel.id === message.conversationId
                  ? { ...channel, unreadCount: 0 }
                  : channel)
              } : current);
            })
            .catch((requestError) => setError(requestError.message));
        }
      } else if (isIncomingMessage) {
        setUnreadChannels((current) => current.map((channel) => channel.id === message.conversationId
          ? {
              ...channel,
              unreadCount: channel.unreadCount + 1,
              lastMessage: message.body || (message.attachment ? `📎 ${message.attachment.name}` : ''),
              lastMessageAt: message.createdAt
            }
          : channel));
        setServerDetail((current) => current ? {
          ...current,
          channels: current.channels.map((channel) => channel.id === message.conversationId
            ? { ...channel, unreadCount: channel.unreadCount + 1 }
            : channel)
        } : current);
        receiveNewMessageNotification(message);
      }
    });
    socket.on('message:updated', (message) => {
      setMessages((current) => current.map((item) => item.id === message.id ? message : item));
      setConversations((current) => current.map((item) => item.id === message.conversationId
        ? { ...item, lastMessage: message.body || (message.attachment ? `📎 ${message.attachment.name}` : '') }
        : item));
    });
    socket.on('message:deleted', ({ id, conversationId }) => {
      setMessages((current) => current.map((item) => item.id === id ? { ...item, body: '', deletedAt: new Date().toISOString() } : item));
      refreshLists().catch((requestError) => setError(requestError.message));
      if (selectedIdRef.current !== conversationId) return;
    });
    socket.on('message:reaction', (event) => {
      if (selectedIdRef.current !== event.conversationId) return;
      setMessages((current) => current.map((item) => {
        if (item.id !== event.id) return item;
        const reactions = [...(item.reactions || [])];
        const index = reactions.findIndex((reaction) => reaction.emoji === event.emoji);
        if (event.count === 0) {
          if (index !== -1) reactions.splice(index, 1);
        } else if (index === -1) {
          reactions.push({
            emoji: event.emoji,
            count: event.count,
            reactedByMe: event.userId === user.id && event.active
          });
        } else {
          reactions[index] = {
            ...reactions[index],
            count: event.count,
            ...(event.userId === user.id ? { reactedByMe: event.active } : {})
          };
        }
        return { ...item, reactions };
      }));
    });
    socket.on('conversation:read', ({ conversationId, userId: readerId }) => {
      if (readerId === user.id) return;
      setMessages((current) => current.map((item) => item.senderId === user.id
        && item.conversationId === conversationId
        ? { ...item, readCount: Math.max(1, item.readCount) }
        : item));
    });
    socket.on('typing:update', (event) => {
      if (event.conversationId !== selectedIdRef.current || event.userId === user.id) return;
      setTyping(event.active ? event.username : null);
    });

    // ── WebRTC Inbound Events ──
    socket.on('call:incoming', ({ conversationId, fromUserId, fromUsername, withVideo, isScreenShare }) => {
      setIncomingCall({
        conversationId,
        fromUserId,
        fromUsername,
        withVideo,
        isScreenShare
      });
    });

    socket.on('call:accepted', async () => {
      if (!peerConnectionRef.current) return;
      try {
        const offer = await peerConnectionRef.current.createOffer();
        await peerConnectionRef.current.setLocalDescription(offer);
        socketRef.current?.emit('call:signal', {
          targetUserId: callPeerUser?.id,
          conversationId: selectedIdRef.current,
          signalData: { sdp: peerConnectionRef.current.localDescription }
        });
      } catch (err) {
        console.error('Fehler beim Erstellen des WebRTC-Angebots:', err);
      }
    });

    socket.on('call:rejected', ({ reason }) => {
      cleanupCall();
      setInfo(reason === 'busy' ? 'Teilnehmer ist bereits in einem Gespräch.' : 'Anruf wurde abgelehnt.');
    });

    socket.on('call:signal', async ({ signalData, fromUserId }) => {
      if (!peerConnectionRef.current) return;
      try {
        if (signalData.sdp) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
          if (signalData.sdp.type === 'offer') {
            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);
            socketRef.current?.emit('call:signal', {
              targetUserId: fromUserId,
              conversationId: selectedIdRef.current,
              signalData: { sdp: peerConnectionRef.current.localDescription }
            });
          }
        } else if (signalData.candidate) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        }
      } catch (err) {
        console.error('Fehler bei WebRTC-Signaling-Verarbeitung:', err);
      }
    });

    socket.on('call:ended', () => {
      cleanupCall();
      setInfo('Gespräch wurde beendet.');
    });

    return () => {
      window.clearTimeout(typingTimer.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, user.id, onToken, refreshLists, refreshUnreadChannels, callPeerUser]);

  // ── WebRTC Actions: Audio, Video & Bildschirmübertragung ──
  function cleanupCall() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setCallActive(false);
    setIncomingCall(null);
    setCallPeerUser(null);
    setIsMuted(false);
    setIsVideoMuted(false);
    setIsScreenSharing(false);
  }

  function createPeerConnection(targetUserId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('call:signal', {
          targetUserId,
          conversationId: selectedIdRef.current,
          signalData: { candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }

  function getMediaErrorMessage(err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
      return 'Mikrofon-/Kamerazugriff nicht erlaubt. Prüfe die App-Berechtigungen in Windows und erlaube den Zugriff im Browser.';
    }
    if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
      return 'Kein passendes Mikrofon oder keine Kamera gefunden. Bitte prüfe, ob ein Gerät angeschlossen ist.';
    }
    if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
      return 'Mikrofon oder Kamera ist bereits in einer anderen App geöffnet.';
    }
    return 'Mikrofon-/Kamera konnte nicht gestartet werden. Prüfe die Geräteverbindung und Berechtigungen.';
  }

  async function startCall(type = 'audio') {
    if (!selected?.peer) return;
    setCallType(type);
    setCallPeerUser(selected.peer);
    setCallActive(true);

    try {
      let stream;
      if (type === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        setIsScreenSharing(true);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video'
        });
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = createPeerConnection(selected.peer.id);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      socketRef.current?.emit('call:initiate', {
        conversationId: selected.id,
        targetUserId: selected.peer.id,
        withVideo: type === 'video',
        isScreenShare: type === 'screen'
      });
    } catch (err) {
      console.error('Konnte Medien nicht öffnen:', err);
      setError(getMediaErrorMessage(err));
      cleanupCall();
    }
  }

  async function acceptCall() {
    if (!incomingCall) return;
    const { fromUserId, conversationId, withVideo, isScreenShare } = incomingCall;
    const type = isScreenShare ? 'screen' : withVideo ? 'video' : 'audio';
    setCallType(type);
    setCallPeerUser({ id: fromUserId, username: incomingCall.fromUsername });
    setCallActive(true);
    setIncomingCall(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: withVideo
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = createPeerConnection(fromUserId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      socketRef.current?.emit('call:accept', {
        conversationId,
        targetUserId: fromUserId
      });
    } catch (err) {
      console.error('Konnte Anruf nicht annehmen:', err);
      setError(getMediaErrorMessage(err));
      rejectCall();
      cleanupCall();
    }

  }

  function rejectCall() {
    if (!incomingCall) return;
    socketRef.current?.emit('call:reject', {
      conversationId: incomingCall.conversationId,
      targetUserId: incomingCall.fromUserId
    });
    setIncomingCall(null);
  }

  function endCall() {
    if (callPeerUser) {
      socketRef.current?.emit('call:end', {
        targetUserId: callPeerUser.id,
        conversationId: selectedIdRef.current
      });
    }
    cleanupCall();
  }

  function toggleMute() {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }

  function toggleVideo() {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoMuted(!videoTrack.enabled);
    }
  }

  async function toggleScreenShare() {
    if (!peerConnectionRef.current) return;
    if (isScreenSharing) {
      // Zurück zur Webcam
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const videoTrack = stream.getVideoTracks()[0];
        const sender = peerConnectionRef.current.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        localStreamRef.current = stream;
        setIsScreenSharing(false);
      } catch (e) {
        console.error(e);
      }
    } else {
      // Bildschirm freigeben
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        const sender = peerConnectionRef.current.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          peerConnectionRef.current.addTrack(screenTrack, screenStream);
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;
        setIsScreenSharing(true);
        screenTrack.onended = () => {
          setIsScreenSharing(false);
        };
      } catch (err) {
        console.error('Bildschirmübertragung abgebrochen:', err);
      }
    }
  }


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, typing]);

  useEffect(() => {
    if (section !== 'contacts' || search.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      request(`/users/search?q=${encodeURIComponent(search.trim())}`, { token, onToken })
        .then((result) => { if (active) setResults(result.users); })
        .catch((requestError) => { if (active) setError(requestError.message); });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, section, token, onToken]);

  const activeChannel = activeServerId
    ? serverDetail?.channels?.find((channel) => channel.id === activeChannelId) || null
    : null;
  const selected = activeServerId
    ? activeChannel
      ? { ...activeChannel, id: activeChannel.id, name: `#${activeChannel.name}`, type: 'server-channel', serverId: activeServerId }
      : null
    : conversations.find((item) => item.id === selectedId) || null;
  const activeServer = servers.find((server) => server.id === activeServerId) || serverDetail?.server || null;
  const serverPermissions = serverDetail?.server?.myPermissions || {};
  const conversationQuery = search.trim().toLocaleLowerCase();
  const visibleConversations = conversations.filter((item) => !conversationQuery
    || (item.name || '').toLocaleLowerCase().includes(conversationQuery)
    || (item.lastMessage || '').toLocaleLowerCase().includes(conversationQuery));
  const totalUnreadCount = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0)
    + unreadChannels.reduce((total, channel) => total + channel.unreadCount, 0);
  const notificationItems = [
    ...conversations
      .filter((conversation) => conversation.unreadCount > 0)
      .map((conversation) => ({ ...conversation, kind: 'conversation' })),
    ...unreadChannels.map((channel) => ({ ...channel, kind: 'channel' }))
  ].sort((first, second) => new Date(second.lastMessageAt || 0) - new Date(first.lastMessageAt || 0));

  useEffect(() => {
    const originalTitle = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = totalUnreadCount > 0 ? `(${totalUnreadCount}) ${originalTitle}` : originalTitle;
  }, [totalUnreadCount]);

  useEffect(() => {
    function handleSearchShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSection('chats');
        window.setTimeout(() => chatSearchRef.current?.focus(), 0);
      }
    }
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  async function selectConversation(conversation) {
    setActiveServerId(null);
    activeServerIdRef.current = null;
    setActiveChannelId(null);
    activeChannelIdRef.current = null;
    setSelectedId(conversation.id);
    selectedIdRef.current = conversation.id;
    setSection('chats');
    setMobileMenu(false);
    setMessages([]);
    setTyping(null);
    setError('');
    try {
      const result = await request(`/conversations/${conversation.id}/messages`, { token, onToken });
      if (selectedIdRef.current !== conversation.id) return;
      setMessages(result.messages);
      await request(`/conversations/${conversation.id}/read`, { method: 'POST', token, onToken });
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, unreadCount: 0 } : item));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function selectServer(server) {
    setActiveServerId(server.id);
    activeServerIdRef.current = server.id;
    setActiveChannelId(null);
    activeChannelIdRef.current = null;
    setSelectedId(null);
    selectedIdRef.current = null;
    setMessages([]);
    setGroupDetailsOpen(false);
    setSection('chats');
    setMobileMenu(false);
  }

  async function selectServerChannel(channel, serverId = activeServerId) {
    if (!channel?.id || !serverId) return;
    setActiveServerId(serverId);
    activeServerIdRef.current = serverId;
    setActiveChannelId(channel.id);
    activeChannelIdRef.current = channel.id;
    setSelectedId(channel.id);
    selectedIdRef.current = channel.id;
    setSection('chats');
    setMobileMenu(false);
    setMessages([]);
    setTyping(null);
    setError('');
    try {
      const result = await request(`/conversations/${channel.id}/messages`, { token, onToken });
      if (selectedIdRef.current !== channel.id || activeServerIdRef.current !== serverId) return;
      setMessages(result.messages || []);
      await request(`/conversations/${channel.id}/read`, { method: 'POST', token, onToken });
      setUnreadChannels((current) => current.filter((item) => item.id !== channel.id));
      setServerDetail((current) => current ? {
        ...current,
        channels: current.channels.map((item) => item.id === channel.id ? { ...item, unreadCount: 0 } : item)
      } : current);
      refreshUnreadChannels().catch((requestError) => setError(requestError.message));
    } catch (requestError) {
      if (selectedIdRef.current === channel.id) setError(requestError.message);
    }
  }

  function receiveNewMessageNotification(message) {
    if (notificationSettingsRef.current.sound) playNotificationSound();
    const deliver = (channels) => {
      const conversation = conversationsRef.current.find((item) => item.id === message.conversationId);
      const channel = channels.find((item) => item.id === message.conversationId)
        || unreadChannelsRef.current.find((item) => item.id === message.conversationId);
      const item = conversation
        ? { ...conversation, kind: 'conversation' }
        : channel
          ? { ...channel, kind: 'channel' }
          : null;
      if (!item) return;
      const preview = (message.body || (message.attachment ? `📎 ${message.attachment.name}` : 'Neue Nachricht')).slice(0, 140);
      const toast = {
        ...item,
        preview,
        sender: message.senderUsername || 'Neue Nachricht'
      };
      const canNotifyNatively = document.hidden
        && notificationSettingsRef.current.desktop
        && notificationSupported
        && window.Notification.permission === 'granted';
      if (canNotifyNatively) {
        try {
          const nativeNotification = new window.Notification(`Mingle · ${item.kind === 'channel' ? `#${item.name}` : item.name}`, {
            body: `${toast.sender}: ${preview}`
          });
          nativeNotification.onclick = () => {
            window.focus();
            selectNotificationItem(item);
            nativeNotification.close();
          };
          return;
        } catch (notificationError) {
          setError(notificationError.message);
        }
      }
      setIncomingToast(toast);
    };
    const knownConversation = conversationsRef.current.some((item) => item.id === message.conversationId);
    const knownChannel = unreadChannelsRef.current.some((item) => item.id === message.conversationId);
    if (knownConversation) {
      deliver(unreadChannelsRef.current);
    } else if (knownChannel) {
      deliver(unreadChannelsRef.current);
    } else {
      Promise.all([refreshLists(), refreshUnreadChannels()])
        .then(([, channels]) => deliver(channels))
        .catch((requestError) => setError(requestError.message));
    }
  }

  function selectNotificationItem(item) {
    setNotificationCenterOpen(false);
    setIncomingToast(null);
    if (item.kind === 'channel') {
      const server = servers.find((entry) => entry.id === item.serverId);
      if (server) selectServer(server);
      selectServerChannel({ id: item.id, name: item.name, type: 'text' }, item.serverId);
      return;
    }
    selectConversation(item);
  }

  async function createServer(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const iconUrl = createServerIcon.trim() ? `emoji:${createServerIcon.trim()}` : undefined;
      const result = await request('/servers', {
        method: 'POST',
        token,
        onToken,
        body: { name: createServerName.trim(), ...(iconUrl ? { iconUrl } : {}) }
      });
      await refreshServers();
      setCreateServerOpen(false);
      setCreateServerName('');
      setCreateServerIcon('');
      setActiveChannelId(null);
      activeChannelIdRef.current = null;
      selectServer({ id: result.id });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createServerChannel(event) {
    event.preventDefault();
    if (!activeServerId) return;
    setBusy(true);
    try {
      const channel = await request(`/servers/${activeServerId}/channels`, {
        method: 'POST',
        token,
        onToken,
        body: { name: createChannelName.trim() }
      });
      const detailResult = await request(`/servers/${activeServerId}`, { token, onToken });
      setServerDetail(detailResult);
      setCreateChannelOpen(false);
      setCreateChannelName('');
      const createdChannel = detailResult.channels?.find((item) => item.id === channel.id) || channel;
      await selectServerChannel(createdChannel, activeServerId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function reloadServerManagement() {
    if (!activeServerId) return;
    try {
      const memberResult = await request(`/servers/${activeServerId}/members`, { token, onToken });
      const [roleResult, inviteResult] = await Promise.all([
        serverPermissions.manage_roles
          ? request(`/servers/${activeServerId}/roles`, { token, onToken })
          : Promise.resolve({ roles: serverRoles }),
        serverPermissions.manage_invites
          ? request(`/servers/${activeServerId}/invite`, { token, onToken })
          : Promise.resolve({ invite: serverInvite })
      ]);
      setServerMembers(memberResult.members || []);
      setServerRoles(roleResult.roles || []);
      setServerInvite(inviteResult.invite || null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function changeServerMemberRole(memberId, roleId) {
    try {
      await request(`/servers/${activeServerId}/members/${memberId}/role`, {
        method: 'PATCH', token, onToken, body: { roleId }
      });
      await reloadServerManagement();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function removeServerMember(member) {
    if (!window.confirm(`@${member.username} aus diesem Server entfernen?`)) return;
    try {
      await request(`/servers/${activeServerId}/members/${member.id}`, { method: 'DELETE', token, onToken });
      await reloadServerManagement();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function leaveServer() {
    if (!activeServerId || !window.confirm(`"${activeServer?.name}" wirklich verlassen?`)) return;
    try {
      await request(`/servers/${activeServerId}/leave`, { method: 'POST', token, onToken });
      setActiveServerId(null);
      activeServerIdRef.current = null;
      setActiveChannelId(null);
      activeChannelIdRef.current = null;
      setSelectedId(null);
      selectedIdRef.current = null;
      setMessages([]);
      setServerAdminOpen(false);
      await refreshServers();
      setInfo('Du hast den Server verlassen.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createServerInvite() {
    try {
      const result = await request(`/servers/${activeServerId}/invite`, {
        method: 'POST',
        token,
        onToken,
        body: {
          expiresInHours: inviteExpiry ? Number(inviteExpiry) : null,
          maxUses: inviteMaxUses ? Number(inviteMaxUses) : null
        }
      });
      setServerInvite(result.invite);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function revokeServerInvite() {
    if (!window.confirm('Diesen Einladungslink ungültig machen?')) return;
    try {
      await request(`/servers/${activeServerId}/invite`, { method: 'DELETE', token, onToken });
      setServerInvite(null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function copyServerInvite() {
    if (!serverInvite?.url) return;
    const inviteUrl = /^https?:\/\//.test(serverInvite.url)
      ? serverInvite.url
      : `${window.location.origin}${serverInvite.url}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      setError('Der Einladungslink konnte nicht kopiert werden.');
    }
  }

  async function saveServerRole(event) {
    event.preventDefault();
    if (!activeServerId || !roleDraft) return;
    try {
      const result = await request(`/servers/${activeServerId}/roles/${roleDraft.id}`, {
        method: 'PATCH',
        token,
        onToken,
        body: { name: roleDraft.name, color: roleDraft.color, permissions: roleDraft.permissions }
      });
      setServerRoles((current) => current.map((role) => role.id === result.role.id ? result.role : role));
      setRoleDraft(null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createServerRole(event) {
    event.preventDefault();
    try {
      const result = await request(`/servers/${activeServerId}/roles`, {
        method: 'POST',
        token,
        onToken,
        body: { name: newRoleName.trim(), color: newRoleColor, permissions: newRolePermissions }
      });
      setServerRoles((current) => [...current, result.role]);
      setNewRoleName('');
      setNewRolePermissions({ read_messages: true, send_messages: true });
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteServerRole(role) {
    if (!window.confirm(`Rolle "${role.name}" löschen?`)) return;
    try {
      await request(`/servers/${activeServerId}/roles/${role.id}`, { method: 'DELETE', token, onToken });
      setServerRoles((current) => current.filter((item) => item.id !== role.id));
      if (roleDraft?.id === role.id) setRoleDraft(null);
      await reloadServerManagement();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function openFriend(friendship) {
    setBusy(true);
    setError('');
    try {
      const result = await request('/conversations/direct', {
        method: 'POST',
        token,
        onToken,
        body: { userId: friendship.user.id }
      });
      const list = await refreshLists();
      const conversation = list.find((item) => item.id === result.conversationId);
      if (conversation) await selectConversation(conversation);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendFriendRequest(username) {
    setError('');
    try {
      const result = await request('/friendships', { method: 'POST', token, onToken, body: { username } });
      setInfo(result.status === 'accepted'
        ? `Ihr seid jetzt mit @${username} befreundet.`
        : `Anfrage an @${username} gesendet.`);
      setSearch('');
      await refreshLists();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function acceptFriendship(friendship) {
    setError('');
    try {
      const result = await request(`/friendships/${friendship.id}/accept`, { method: 'POST', token, onToken });
      const list = await refreshLists();
      const conversation = list.find((item) => item.id === result.conversationId);
      if (conversation) await selectConversation(conversation);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function removeFriendship(friendship) {
    if (!window.confirm(`Kontakt @${friendship.user.username} entfernen?`)) return;
    try {
      await request(`/friendships/${friendship.id}`, { method: 'DELETE', token, onToken });
      await refreshLists();
      setInfo('Kontakt entfernt.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function blockUser(peer) {
    if (!window.confirm(`@${peer.username} blockieren? Die Person kann dir dann keine Nachrichten mehr schicken.`)) return;
    try {
      await request('/blocks', { method: 'POST', token, onToken, body: { userId: peer.id } });
      setSelectedId(null);
      selectedIdRef.current = null;
      await refreshLists();
      setInfo(`@${peer.username} wurde blockiert.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function unblockUser(block) {
    try {
      await request(`/blocks/${block.id}`, { method: 'DELETE', token, onToken });
      await refreshLists();
      setInfo(`@${block.username} wurde entblockt.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createGroup(event) {
    event.preventDefault();
    if (groupMembers.length < 2) {
      setError('Wähle mindestens zwei Kontakte für die Gruppe aus.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await request('/groups', {
        method: 'POST',
        token,
        onToken,
        body: { name: groupName, memberIds: groupMembers }
      });
      const list = await refreshLists();
      const conversation = list.find((item) => item.id === result.conversationId);
      setGroupOpen(false);
      setGroupName('');
      setGroupMembers([]);
      if (conversation) await selectConversation(conversation);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function openGroupDetails() {
    if (!selected || selected.type !== 'group') return;
    setGroupDetailsOpen(true);
    setGroupDetails(null);
    setGroupNameDraft(selected.name);
    setGroupAddUserId('');
    try {
      const result = await request(`/groups/${selected.id}`, { token, onToken });
      setGroupDetails(result.group);
      setGroupNameDraft(result.group.name);
    } catch (requestError) {
      setError(requestError.message);
      setGroupDetailsOpen(false);
    }
  }

  async function saveGroupName(event) {
    event.preventDefault();
    if (!selected) return;
    try {
      const result = await request(`/groups/${selected.id}`, {
        method: 'PATCH',
        token,
        onToken,
        body: { name: groupNameDraft }
      });
      setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, name: result.name } : item));
      setGroupDetails((current) => current ? { ...current, name: result.name } : current);
      setInfo('Gruppenname geändert.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function addGroupMember(event) {
    event.preventDefault();
    if (!selected || !groupAddUserId) return;
    try {
      await request(`/groups/${selected.id}/members`, {
        method: 'POST',
        token,
        onToken,
        body: { userId: groupAddUserId }
      });
      const result = await request(`/groups/${selected.id}`, { token, onToken });
      setGroupDetails(result.group);
      setGroupAddUserId('');
      await refreshLists();
      setInfo('Kontakt zur Gruppe hinzugefügt.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function updateGroupRole(member) {
    if (!selected) return;
    const role = member.role === 'admin' ? 'member' : 'admin';
    try {
      await request(`/groups/${selected.id}/members/${member.id}`, {
        method: 'PATCH',
        token,
        onToken,
        body: { role }
      });
      const result = await request(`/groups/${selected.id}`, { token, onToken });
      setGroupDetails(result.group);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function removeGroupMember(member) {
    if (!selected || !member) return;
    const leaving = member.id === user.id;
    if (!window.confirm(leaving ? 'Möchtest du diese Gruppe verlassen?' : `@${member.username} aus der Gruppe entfernen?`)) return;
    try {
      await request(`/groups/${selected.id}/members/${member.id}`, {
        method: 'DELETE',
        token,
        onToken
      });
      if (leaving) {
        setSelectedId(null);
        selectedIdRef.current = null;
        setMessages([]);
        setGroupDetailsOpen(false);
        setGroupDetails(null);
        setInfo('Du hast die Gruppe verlassen.');
      } else {
        const result = await request(`/groups/${selected.id}`, { token, onToken });
        setGroupDetails(result.group);
        setInfo(`@${member.username} wurde aus der Gruppe entfernt.`);
      }
      await refreshLists();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    if ((!draft.trim() && !pendingFile) || !selected || busy) return;
    const text = draft.trim();
    setBusy(true);
    setError('');
    try {
      let result;
      if (pendingFile) {
        const form = new FormData();
        form.append('file', pendingFile);
        if (text) form.append('body', text);
        if (replyTo) form.append('replyTo', replyTo.id);
        result = await request(`/conversations/${selected.id}/attachments`, {
          method: 'POST',
          token,
          onToken,
          body: form
        });
      } else {
        result = await request(`/conversations/${selected.id}/messages`, {
          method: 'POST',
          token,
          onToken,
          body: { body: text, ...(replyTo ? { replyTo: replyTo.id } : {}) }
        });
      }
      setMessages((current) => current.some((item) => item.id === result.message.id)
        ? current
        : [...current, result.message]);
      setConversations((current) => current.map((item) => item.id === selected.id
        ? {
            ...item,
            lastMessage: result.message.body || (result.message.attachment ? `📎 ${result.message.attachment.name}` : ''),
            lastMessageAt: result.message.createdAt
          }
        : item));
      setDraft('');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setReplyTo(null);
      socketRef.current?.emit('typing:set', { conversationId: selected.id, active: false });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function chooseAttachment(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'application/pdf', 'text/plain'
    ]);
    if (!allowedTypes.has(file.type)) {
      setError('Erlaubt sind JPG, PNG, GIF, WebP, PDF und Textdateien.');
      event.target.value = '';
      return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError('Dateien müssen größer als 0 Byte und höchstens 10 MB groß sein.');
      event.target.value = '';
      return;
    }
    setError('');
    setPendingFile(file);
  }

  function updateDraft(value) {
    setDraft(value);
    if (!selected) return;
    socketRef.current?.emit('typing:set', { conversationId: selected.id, active: Boolean(value.trim()) });
    window.clearTimeout(typingTimer.current);
    if (value.trim()) {
      typingTimer.current = window.setTimeout(() => {
        socketRef.current?.emit('typing:set', { conversationId: selected.id, active: false });
      }, 1200);
    }
  }

  async function editMessage(message) {
    const value = window.prompt('Nachricht bearbeiten', message.body);
    if (value === null || value.trim() === message.body) return;
    try {
      const result = await request(`/messages/${message.id}`, {
        method: 'PATCH',
        token,
        onToken,
        body: { body: value }
      });
      setMessages((current) => current.map((item) => item.id === message.id ? result.message : item));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteMessage(message, scope) {
    if (scope === 'everyone' && !window.confirm('Diese Nachricht für alle löschen?')) return;
    try {
      await request(`/messages/${message.id}`, { method: 'DELETE', token, onToken, body: { scope } });
      if (scope === 'me') {
        setMessages((current) => current.filter((item) => item.id !== message.id));
      } else {
        setMessages((current) => current.map((item) => item.id === message.id
          ? { ...item, body: '', deletedAt: new Date().toISOString() }
          : item));
      }
      await refreshLists();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function toggleReaction(message, emoji) {
    try {
      const result = await request(`/messages/${message.id}/reactions`, {
        method: 'POST',
        token,
        onToken,
        body: { emoji }
      });
      setMessages((current) => current.map((item) => item.id === message.id
        ? { ...item, reactions: result.reactions }
        : item));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleAccept(friendship) {
    await acceptFriendship(friendship);
    setMobileMenu(false);
  }

  const settingsVisible = section === 'settings';

  return (
    <main className={`workspace ${theme} ${activeServerId ? 'server-workspace' : ''}`}>
      <nav className="server-rail" aria-label="Server navigation">
        <button className={`rail-home ${!activeServerId ? 'rail-selected' : ''}`} title="Direktnachrichten" aria-label="Direktnachrichten" onClick={() => {
          setActiveServerId(null); activeServerIdRef.current = null; setActiveChannelId(null); activeChannelIdRef.current = null; setSelectedId(null); selectedIdRef.current = null; setMessages([]); setSection('chats');
        }}>
          <img src="/favicon.svg" alt="" />
        </button>
        <span className="rail-divider" />
        <div className="rail-server-list">
          {servers.map((server) => {
            const serverIcon = server.icon_url || server.iconUrl || '';
            return <button key={server.id} className={`rail-server ${activeServerId === server.id ? 'rail-selected' : ''}`} title={server.name} aria-label={`${server.name} server`} onClick={() => selectServer(server)}>
              {serverIcon.startsWith('emoji:') ? serverIcon.slice(6) : serverIcon ? <img src={serverIcon} alt="" /> : (server.name || '?').trim().slice(0, 2).toUpperCase()}
              {activeServerId === server.id && <i />}
            </button>;
          })}
        </div>
        <button className="rail-add" title="Server erstellen" aria-label="Server erstellen" onClick={() => setCreateServerOpen(true)}><Plus size={20} /></button>
        <button className="rail-discover" title="Einladungslink öffnen" aria-label="Einladungslink öffnen" onClick={() => {
          const value = window.prompt('Einladungscode oder Link eingeben');
          if (value) {
            const match = value.trim().match(/(?:\/invite\/)?([A-Za-z0-9_-]{6,})\/?$/);
            if (match) onOpenInvite(match[1]);
            else setError('Der Einladungslink sieht nicht gültig aus.');
          }
        }}><Compass size={18} /></button>
      </nav>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          {activeServer ? <div className="sidebar-server-title"><span>{(activeServer.icon_url || activeServer.iconUrl || '').startsWith('emoji:')
            ? (activeServer.icon_url || activeServer.iconUrl).slice(6)
            : (activeServer.icon_url || activeServer.iconUrl)
              ? <img src={activeServer.icon_url || activeServer.iconUrl} alt="" />
              : (activeServer.name || 'S').slice(0, 1).toUpperCase()}</span><b>{activeServer.name}</b></div> : <Brand />}
          <button className="icon-button mobile-menu-close" aria-label="Menü schließen" onClick={() => setMobileMenu(false)}><X size={19} /></button>
          <button className="icon-button more-button" aria-label="Abmelden" title="Abmelden" onClick={onLogout}><LogOut size={17} /></button>
        </div>
        {!activeServer && <div className="sidebar-greeting"><span>DEIN MESSENGER</span><h1>Hallo, {user.username} <span className="wave">✦</span></h1><p>{friendships.incoming.length ? `${friendships.incoming.length} neue Anfrage${friendships.incoming.length === 1 ? '' : 'n'}` : 'Was gibt’s Neues?'}</p></div>}
        <div className="sidebar-tabs">
          <button className={section === 'chats' && !activeServer ? 'active' : ''} onClick={() => { setActiveServerId(null); activeServerIdRef.current = null; setActiveChannelId(null); activeChannelIdRef.current = null; setSelectedId(null); selectedIdRef.current = null; setMessages([]); setSection('chats'); setMobileMenu(false); }}><MessageCircle size={16} /> Chats</button>
          <button className={section === 'contacts' ? 'active' : ''} onClick={() => { setSection('contacts'); setMobileMenu(false); }}><UsersRound size={16} /> Kontakte{friendships.incoming.length > 0 && <i className="tab-count">{friendships.incoming.length}</i>}</button>
          <button className={settingsVisible ? 'active' : ''} onClick={() => { setSection('settings'); setMobileMenu(false); }}><Settings size={16} /> Konto</button>
        </div>
        {section === 'chats' && activeServerId && (
          <section className="server-channel-sidebar">
            <div className="server-sidebar-actions">
              <button onClick={() => { setServerAdminTab('invites'); setServerAdminOpen(true); }} disabled={!serverPermissions.manage_invites}><UserPlus size={15} /> Einladung</button>
              <button onClick={() => { setServerAdminTab('members'); setServerAdminOpen(true); }} disabled={!serverPermissions.manage_roles && !serverPermissions.manage_server && !serverPermissions.kick_members}><Settings2 size={15} /> Verwalten</button>
            </div>
            <div className="server-channel-heading"><span>TEXTKANÄLE</span>{serverPermissions.manage_channels && <button className="icon-button" title="Kanal erstellen" aria-label="Kanal erstellen" onClick={() => setCreateChannelOpen(true)}><Plus size={16} /></button>}</div>
            <div className="server-channel-list">
              {!serverDetail ? <p className="server-loading">Kanäle werden geladen …</p> : serverDetail.channels?.length ? serverDetail.channels.map((channel) => <button key={channel.id} className={`server-channel-item ${activeChannelId === channel.id ? 'selected' : ''}`} onClick={() => selectServerChannel(channel)}><Hash size={16} /><span>{channel.name}</span>{channel.unreadCount > 0 && <i>{channel.unreadCount > 99 ? '99+' : channel.unreadCount}</i>}</button>) : <p className="server-loading">Keine lesbaren Kanäle vorhanden.</p>}
            </div>
            <button className="server-leave-button" onClick={leaveServer} disabled={activeServer?.owner_id === user.id}>Server verlassen</button>
          </section>
        )}
        {section === 'chats' && !activeServerId && (
          <>
            <label className="search-box"><Search size={16} /><input ref={chatSearchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Chats durchsuchen" /><kbd>Ctrl K</kbd></label>
            <div className="conversation-list">
              {visibleConversations.length === 0 ? (
                <div className="chat-list-empty">
                  <span className="empty-icon"><MessageCircle size={19} /></span>
                  <strong>{search ? 'Nichts gefunden' : 'Noch ganz ruhig hier'}</strong>
                  <p>{search ? 'Versuche einen anderen Suchbegriff.' : 'Füge Kontakte hinzu und starte eure erste Unterhaltung.'}</p>
                  {!search && <button className="text-button" onClick={() => setSection('contacts')}>Kontakte finden <ArrowRight size={14} /></button>}
                </div>
              ) : visibleConversations.map((conversation) => (
                <button key={conversation.id} className={`conversation-item ${selectedId === conversation.id ? 'selected' : ''}`} onClick={() => selectConversation(conversation)}>
                  <Avatar name={conversation.name || 'Gruppe'} online={conversation.peer?.online} />
                  <span className="conversation-info"><b>{conversation.name}</b><small>{conversation.lastMessage || (conversation.type === 'group' ? 'Gruppenchat' : 'Noch keine Nachrichten')}</small></span>
                  <span className="conversation-side"><time>{messageTime(conversation.lastMessageAt)}</time>{conversation.unreadCount > 0 && <i>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</i>}</span>
                </button>
              ))}
            </div>
            <button className="new-chat-button" onClick={() => { setSection('contacts'); setMobileMenu(false); }}><span>+</span> Neue Unterhaltung</button>
          </>
        )}
        {section === 'contacts' && (
          <div className="contacts-panel">
            <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nutzername suchen" /><UserPlus size={15} /></label>
            <button className="new-chat-button group-create-toggle" onClick={() => setGroupOpen((open) => !open)}><span>{groupOpen ? '−' : '+'}</span> Gruppe erstellen</button>
            {groupOpen && <form className="group-create-form" onSubmit={createGroup}>
              <label className="field"><span>Gruppenname</span><input className="plain-input" value={groupName} onChange={(event) => setGroupName(event.target.value)} minLength="2" maxLength="60" placeholder="z. B. Wochenendplanung" required /></label>
              <span className="contact-group-title">MINDESTENS ZWEI KONTAKTE</span>
              {friendships.accepted.map((friend) => <label className="group-choice" key={friend.user.id}><input type="checkbox" checked={groupMembers.includes(friend.user.id)} onChange={(event) => setGroupMembers((current) => event.target.checked ? [...current, friend.user.id] : current.filter((id) => id !== friend.user.id))} /><Avatar name={friend.user.username} online={friend.user.online} /><span>@{friend.user.username}</span></label>)}
              <button className="button button-primary group-submit" disabled={busy || groupMembers.length < 2}>{busy ? 'Wird erstellt …' : 'Gruppe erstellen'}</button>
            </form>}
            {search.trim().length > 0 && search.trim().length < 2 && <p className="search-hint">Mindestens 2 Zeichen eingeben.</p>}
            {results.length > 0 && <div className="contact-group"><span className="contact-group-title">SUCHERGEBNISSE</span>{results.map((result) => {
              const alreadyConnected = friendships.accepted.some((friend) => friend.user.id === result.id);
              const requestPending = friendships.outgoing.some((friend) => friend.user.id === result.id);
              return <div className="contact-item" key={result.id}><Avatar name={result.username} online={result.online} /><span><b>@{result.username}</b><small>{result.online ? 'Online' : 'Mingle-Nutzer'}</small></span><button className="contact-action" disabled={alreadyConnected || requestPending} title={alreadyConnected ? 'Bereits befreundet' : requestPending ? 'Anfrage offen' : 'Anfrage senden'} onClick={() => sendFriendRequest(result.username)}>{alreadyConnected ? <Check size={16} /> : requestPending ? <CheckCheck size={16} /> : <UserPlus size={16} />}</button></div>;
            })}</div>}
            {search.trim().length >= 2 && results.length === 0 && <p className="search-hint">Keine passenden Nutzer gefunden.</p>}
            {friendships.incoming.length > 0 && <div className="contact-group"><span className="contact-group-title">ANFRAGEN <i>{friendships.incoming.length}</i></span>{friendships.incoming.map((friend) => <div className="contact-item" key={friend.id}><Avatar name={friend.user.username} online={friend.user.online} /><span><b>@{friend.user.username}</b><small>Möchte dein Kontakt sein</small></span><button className="contact-action accepted" aria-label="Anfrage annehmen" onClick={() => handleAccept(friend)}><Check size={16} /></button><button className="contact-action muted" aria-label="Anfrage ablehnen" onClick={() => removeFriendship(friend)}><X size={16} /></button></div>)}</div>}
            {friendships.outgoing.length > 0 && <div className="contact-group"><span className="contact-group-title">AUSSTEHEND</span>{friendships.outgoing.map((friend) => <div className="contact-item" key={friend.id}><Avatar name={friend.user.username} /><span><b>@{friend.user.username}</b><small>Anfrage gesendet</small></span><button className="contact-action muted" title="Anfrage zurückziehen" onClick={() => removeFriendship(friend)}><X size={16} /></button></div>)}</div>}
            <div className="contact-group">
              <span className="contact-group-title">KONTAKTE <i>{friendships.accepted.length}</i></span>
              {friendships.accepted.length === 0 ? <p className="search-hint">Deine angenommenen Kontakte erscheinen hier.</p> : friendships.accepted.map((friend) => <div className="contact-item" key={friend.id}><Avatar name={friend.user.username} online={friend.user.online} /><button className="contact-name" onClick={() => openFriend(friend)}><b>@{friend.user.username}</b><small>{friend.user.online ? 'Online' : 'Kontakt'}</small></button><button className="contact-action" title="Chat öffnen" onClick={() => openFriend(friend)}><MessageCircle size={16} /></button><button className="contact-action muted" title="Kontakt entfernen" onClick={() => removeFriendship(friend)}><UserX size={16} /></button></div>)}
            </div>
            {blocks.length > 0 && <div className="contact-group"><span className="contact-group-title">BLOCKIERT</span>{blocks.map((block) => <div className="contact-item" key={block.id}><Avatar name={block.username} /><span><b>@{block.username}</b><small>Blockiert</small></span><button className="contact-action muted" title="Entblocken" onClick={() => unblockUser(block)}><Ban size={16} /></button></div>)}</div>}
          </div>
        )}
        <div className="sidebar-bottom">
          <button className="profile-row" onClick={() => setSection('settings')}>
            <Avatar name={user.username} online />
            <span className="profile-meta"><b>{user.username}</b><small>Mein Profil</small></span>
            <ChevronDown size={16} />
          </button>
          <div className="sidebar-footer"><span><i /> Sicher verbunden</span><button className="icon-button" aria-label="Abmelden" title="Abmelden" onClick={onLogout}><LogOut size={17} /></button></div>
        </div>
      </aside>
      {mobileMenu && <button className="mobile-scrim" aria-label="Menü schließen" onClick={() => setMobileMenu(false)} />}

      <section className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu-open" aria-label="Menü öffnen" onClick={() => setMobileMenu(true)}><Menu size={20} /></button>
          <div className="topbar-context"><span className={`context-dot ${selected?.peer?.online ? '' : 'offline'}`} /><span>{settingsVisible ? 'Dein Konto' : selected ? selected.name : section === 'contacts' ? 'Kontakte' : activeServer?.name || 'Deine Nachrichten'}</span></div>
          <div className="topbar-actions">
            {selected?.peer && <span className="presence-label">{typing ? 'schreibt gerade…' : selected.peer.online ? 'online' : 'offline'}</span>}
            <NotificationCenter
              open={notificationCenterOpen}
              unreadCount={totalUnreadCount}
              items={notificationItems}
              onToggle={() => setNotificationCenterOpen((open) => !open)}
              onSelect={selectNotificationItem}
            />
            <span className="secure-label"><ShieldCheck size={15} /> Sicher verbunden</span>
            {selected?.peer && <button className="icon-button block-button" title="Kontakt blockieren" aria-label="Kontakt blockieren" onClick={() => blockUser(selected.peer)}><Ban size={17} /></button>}
            {selected?.type === 'server-channel' && <button className="icon-button server-member-toggle" title="Mitglieder anzeigen" aria-label="Mitglieder anzeigen" onClick={() => setServerMembersOpen((open) => !open)}><UsersRound size={17} /></button>}
            <button className="icon-button theme-toggle" onClick={onThemeToggle} title={theme === 'light' ? 'Dunkles Design' : 'Helles Design'} aria-label="Design wechseln">{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
          </div>
        </header>
        {settingsVisible ? (
          <SettingsPage
            user={user}
            token={token}
            onUserChange={onUserChange}
            onToken={onToken}
            onLogout={onLogout}
            notificationSettings={notificationSettings}
            notificationPermission={notificationPermission}
            notificationSupported={notificationSupported}
            notificationNotice={notificationNotice}
            onDesktopNotificationsChange={toggleDesktopNotifications}
            onNotificationSoundChange={toggleNotificationSound}
          />
        ) : selected ? (
          <section className={`chat-room ${selected.type === 'server-channel' ? 'server-chat-room' : ''}`}>
            <div className="chat-room-header">
              <Avatar name={selected.name || 'Gruppe'} online={selected.peer?.online} />
              <div><h2>{selected.name}</h2><p>{selected.type === 'server-channel'
                ? `${activeServer?.name || 'Server'} · ${activeServer?.member_count ?? activeServer?.memberCount ?? 0} Mitglieder`
                : typing ? `${typing} schreibt gerade…` : selected.peer?.online ? 'online' : selected.type === 'group' ? 'Gruppenunterhaltung' : 'zuletzt gesehen'}</p></div>
              {selected.peer && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                  <button className="call-action-btn" title="Sprachanruf starten" aria-label="Sprachanruf starten" onClick={() => startCall('audio')} disabled={callActive}>
                    <Phone size={17} />
                  </button>
                  <button className="call-action-btn" title="Videoanruf starten" aria-label="Videoanruf starten" onClick={() => startCall('video')} disabled={callActive}>
                    <Video size={17} />
                  </button>
                  <button className="call-action-btn" title="Bildschirm übertragen" aria-label="Bildschirm übertragen" onClick={() => startCall('screen')} disabled={callActive}>
                    <Monitor size={17} />
                  </button>
                </div>
              )}
              {selected.type === 'group' && <button className="icon-button group-details-button" title="Gruppen verwalten" aria-label="Gruppen verwalten" onClick={openGroupDetails}><UsersRound size={17} /></button>}
              {selected.type === 'server-channel' && serverPermissions.manage_roles && <button className="icon-button group-details-button" title="Server verwalten" aria-label="Server verwalten" onClick={() => { setServerAdminTab('members'); setServerAdminOpen(true); }}><Settings2 size={17} /></button>}
              {selected.peer && <button className="icon-button block-button mobile-block-button" title="Kontakt blockieren" aria-label="Kontakt blockieren" onClick={() => blockUser(selected.peer)}><Ban size={17} /></button>}
            </div>
            {/* ── Active WebRTC Call Overlay ── */}
            {callActive && (
              <div className="active-call-overlay">
                <div className={`call-video-grid ${callType !== 'audio' ? 'with-remote' : ''}`}>
                  {callType !== 'audio' ? (
                    <div className="remote-video-container">
                      <video ref={remoteVideoRef} autoPlay playsInline />
                      <div className="local-video-pip">
                        <video ref={localVideoRef} autoPlay playsInline muted />
                      </div>
                    </div>
                  ) : (
                    <div className="call-audio-only-placeholder">
                      <div className="call-audio-pulse">
                        <Phone size={44} color="#818cf8" />
                      </div>
                      <h3>Sprachanruf mit @{callPeerUser?.username || 'Kontakt'}</h3>
                      <p>Verbunden über sicheres WebRTC</p>
                      {/* Unsichtbare Audio-Wiedergabe */}
                      <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }} />
                    </div>
                  )}
                </div>
                <div className="call-control-bar">
                  <button className={`btn-call-ctrl ${isMuted ? 'active-muted' : ''}`} title={isMuted ? 'Mikrofon aktivieren' : 'Stummschalten'} onClick={toggleMute}>
                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                  <button className={`btn-call-ctrl ${isVideoMuted ? 'active-muted' : ''}`} title={isVideoMuted ? 'Kamera aktivieren' : 'Kamera deaktivieren'} onClick={toggleVideo}>
                    {isVideoMuted ? <VideoOff size={20} /> : <Video size={20} />}
                  </button>
                  <button className={`btn-call-ctrl ${isScreenSharing ? 'active-screen' : ''}`} title={isScreenSharing ? 'Bildschirmübertragung stoppen' : 'Bildschirm übertragen'} onClick={toggleScreenShare}>
                    {isScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
                  </button>
                  <button className="btn-call-hangup" title="Auflegen" onClick={endCall}>
                    <PhoneOff size={22} />
                  </button>
                </div>
              </div>
            )}
            {error && <div className="chat-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fehler schließen"><X size={14} /></button></div>}
            {groupDetailsOpen && selected.type === 'group' && <aside className="group-details-panel">
              <div className="group-details-heading"><div><span className="auth-kicker">GRUPPE</span><h3>Mitglieder & Verwaltung</h3></div><button className="icon-button" aria-label="Gruppendetails schließen" onClick={() => setGroupDetailsOpen(false)}><X size={17} /></button></div>
              {!groupDetails ? <div className="attachment-loading">Gruppendaten werden geladen …</div> : <>
                {groupDetails.myRole === 'admin' && <form className="group-rename-form" onSubmit={saveGroupName}>
                  <label className="field"><span>Gruppenname</span><input className="plain-input" value={groupNameDraft} onChange={(event) => setGroupNameDraft(event.target.value)} minLength="2" maxLength="60" required /></label>
                  <button className="button button-primary" disabled={groupNameDraft.trim() === groupDetails.name}>Speichern</button>
                </form>}
                <div className="group-details-members"><span className="contact-group-title">MITGLIEDER <i>{groupDetails.members.length}</i></span>
                  {groupDetails.members.map((member) => <div className="group-member-row" key={member.id}>
                    <Avatar name={member.username} online={member.online} />
                    <span className="group-member-meta"><b>{member.username}{member.id === user.id ? ' (du)' : ''}</b><small>{member.role === 'admin' ? 'Admin' : 'Mitglied'}</small></span>
                    {groupDetails.myRole === 'admin' && member.id !== user.id && <button className="contact-action" title={member.role === 'admin' ? 'Admin-Rolle entfernen' : 'Zum Admin machen'} aria-label={member.role === 'admin' ? `${member.username} zum Mitglied machen` : `${member.username} zum Admin machen`} onClick={() => updateGroupRole(member)}>{member.role === 'admin' ? <ShieldCheck size={15} /> : <Settings size={15} />}</button>}
                    {groupDetails.myRole === 'admin' && member.id !== user.id && <button className="contact-action muted" title="Aus Gruppe entfernen" aria-label={`${member.username} aus Gruppe entfernen`} onClick={() => removeGroupMember(member)}><UserX size={15} /></button>}
                  </div>)}
                </div>
                {groupDetails.myRole === 'admin' && <form className="group-add-form" onSubmit={addGroupMember}>
                  <label className="field"><span>Kontakt hinzufügen</span><select className="plain-input" value={groupAddUserId} onChange={(event) => setGroupAddUserId(event.target.value)} required>
                    <option value="">Kontakt auswählen …</option>
                    {friendships.accepted.filter((friend) => !groupDetails.members.some((member) => member.id === friend.user.id)).map((friend) => <option key={friend.user.id} value={friend.user.id}>@{friend.user.username}</option>)}
                  </select></label>
                  <button className="button button-dark" disabled={!groupAddUserId}>Hinzufügen</button>
                </form>}
                <button className="button button-danger group-leave-button" onClick={() => removeGroupMember(groupDetails.members.find((member) => member.id === user.id))}>Gruppe verlassen</button>
              </>}
            </aside>}
            <div className="conversation-body">
              <div className="message-list">
                {messages.length === 0 && <div className="conversation-start"><Avatar name={selected.name || 'Gruppe'} size="large" online={selected.peer?.online} /><h3>{selected.type === 'server-channel' ? `Willkommen in ${selected.name}` : 'Das ist euer Anfang.'}</h3><p>{selected.type === 'server-channel' ? (activeChannel?.topic || 'Dies ist der Anfang dieses Kanals.') : `Schick ${selected.peer ? `@${selected.peer.username}` : 'der Gruppe'} die erste Nachricht.`}</p></div>}
                {messages.map((message) => <MessageBubble
                  key={message.id}
                  message={message}
                  mine={message.senderId === user.id}
                  token={token}
                  onToken={onToken}
                  onReply={setReplyTo}
                  onEdit={editMessage}
                  onDelete={deleteMessage}
                  onReact={toggleReaction}
                />)}
                {typing && <div className="typing-indicator"><span /><span /><span /> {typing} schreibt</div>}
                <div ref={messagesEndRef} />
              </div>
              {selected.type === 'server-channel' && serverMembersOpen && <aside className="server-member-pane">
                <div className="server-member-heading"><span>MITGLIEDER</span><b>{serverMembers.length}</b></div>
                {!serverMembers.length ? <p className="server-loading">Mitglieder werden geladen …</p> : serverMembers.map((member) => <div className="server-member-item" key={member.id}>
                  <Avatar name={member.username} online={member.online} />
                  <span><b>{member.username}{member.id === user.id ? ' (du)' : ''}</b><small style={{ color: member.color || undefined }}>{member.role_name || 'Mitglied'}</small></span>
                  {member.role_name === 'Owner' && <Crown size={13} />}
                </div>)}
              </aside>}
            </div>
            {selected.type === 'server-channel' && !serverPermissions.send_messages
              ? <div className="server-readonly-note"><LockKeyhole size={15} /> Du kannst diesen Kanal lesen, aber nicht schreiben.</div>
              : <form className="composer" onSubmit={sendMessage}>
              {replyTo && <div className="replying-to"><span><b>Antwort an {replyTo.senderUsername || 'dich'}</b><small>{replyTo.body}</small></span><button type="button" aria-label="Antwort abbrechen" onClick={() => setReplyTo(null)}><X size={15} /></button></div>}
              {pendingFile && <div className="pending-attachment"><Paperclip size={14} /><span>{pendingFile.name}<small>{(pendingFile.size / (1024 * 1024)).toFixed(1)} MB</small></span><button type="button" aria-label="Dateianhang entfernen" onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}><X size={15} /></button></div>}
              <div className="composer-row">
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,application/pdf,text/plain" onChange={chooseAttachment} />
                <button className="icon-button attachment-button" type="button" title="Bild, Video oder Datei anhängen" aria-label="Bild, Video oder Datei anhängen" onClick={() => fileInputRef.current?.click()}><Paperclip size={18} /></button>
                <textarea
                  value={draft}
                  onChange={(event) => updateDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }}
                  placeholder={pendingFile ? 'Nachricht zur Datei hinzufügen …' : 'Schreib eine Nachricht …'}
                  maxLength={4000}
                  rows={1}
                  aria-label="Nachricht"
                />
                <button className="send-button" type="submit" disabled={(!draft.trim() && !pendingFile) || busy} aria-label="Nachricht senden"><Send size={18} /></button>
              </div>
              <div className="composer-hint">{selected.type === 'server-channel' ? `Schreibe in ${selected.name}` : 'Bilder und Dateien bis 10 MB'} <span>·</span> Enter zum Senden</div>
              </form>}
          </section>
        ) : (
          <div className="welcome-panel">
            <div className="welcome-art">
              <div className="welcome-orbit" />
              <div className="welcome-bubble bubble-a"><span className="bubble-avatar lavender">L</span><i /></div>
              <div className="welcome-bubble bubble-b"><span className="bubble-avatar peach">M</span><i /><i /></div>
              <div className="welcome-center"><Brand compact /></div>
              <div className="welcome-spark spark-a">✦</div><div className="welcome-spark spark-b">✳</div>
            </div>
            <span className="auth-kicker">{section === 'contacts' ? 'DEINE MENSCHEN' : 'DEIN NEUER LIEBLINGSORT'}</span>
            <h2>{section === 'contacts' ? <>Gute Gespräche<br />beginnen mit <em>Hallo.</em></> : <>Gute Gespräche<br />beginnen mit <em>Hallo.</em></>}</h2>
            <p>{section === 'contacts' ? 'Suche nach einem Benutzernamen und sende eine Kontaktanfrage.' : 'Wähle einen Kontakt aus oder finde jemanden, mit dem du schreiben möchtest.'}</p>
            {section === 'chats' && <button className="button button-primary welcome-button" onClick={() => setSection('contacts')}>Leute entdecken <ArrowRight size={17} /></button>}
            <div className="welcome-note"><span><Check size={14} /> Ohne Telefonnummer</span><span><CheckCheck size={15} /> Deine Chats, deine Regeln</span></div>
          </div>
        )}
        {createServerOpen && <div className="server-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateServerOpen(false); }}>
          <section className="server-dialog" role="dialog" aria-modal="true" aria-labelledby="create-server-title">
            <div className="server-dialog-heading"><div><span className="auth-kicker">DEIN EIGENER ORT</span><h2 id="create-server-title">Server erstellen</h2><p>Starte einen gemeinsamen Raum. Kanäle und Rollen kannst du später ergänzen.</p></div><button className="icon-button" aria-label="Schließen" onClick={() => setCreateServerOpen(false)}><X size={18} /></button></div>
            <form className="server-form" onSubmit={createServer}>
              <label className="field"><span>Servername</span><input className="plain-input" value={createServerName} onChange={(event) => setCreateServerName(event.target.value)} minLength="2" maxLength="50" placeholder="z. B. Studio Kollektiv" required autoFocus /></label>
              <label className="field"><span>Emoji (optional)</span><input className="plain-input server-emoji-input" value={createServerIcon} onChange={(event) => setCreateServerIcon(event.target.value)} maxLength="8" placeholder="✦" /></label>
              <button className="button button-primary" disabled={busy}>{busy ? 'Wird erstellt …' : 'Server erstellen'} <ArrowRight size={16} /></button>
            </form>
          </section>
        </div>}
        {createChannelOpen && <div className="server-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateChannelOpen(false); }}>
          <section className="server-dialog server-channel-dialog" role="dialog" aria-modal="true" aria-labelledby="create-channel-title">
            <div className="server-dialog-heading"><div><span className="auth-kicker">KANAL ERSTELLEN</span><h2 id="create-channel-title">Ein neuer Gesprächsraum</h2><p>Nutze einen kurzen Namen ohne Leerzeichen.</p></div><button className="icon-button" aria-label="Schließen" onClick={() => setCreateChannelOpen(false)}><X size={18} /></button></div>
            <form className="server-form" onSubmit={createServerChannel}>
              <label className="field"><span>Kanalname</span><div className="server-channel-name-input"><Hash size={17} /><input className="plain-input" value={createChannelName} onChange={(event) => setCreateChannelName(event.target.value)} minLength="2" maxLength="40" placeholder="projektideen" required autoFocus /></div></label>
              <button className="button button-primary" disabled={busy}>{busy ? 'Wird erstellt …' : 'Kanal erstellen'} <Plus size={16} /></button>
            </form>
          </section>
        </div>}
        {serverAdminOpen && activeServer && <div className="server-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setServerAdminOpen(false); }}>
          <section className="server-dialog server-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="server-admin-title">
            <div className="server-dialog-heading"><div><span className="auth-kicker">SERVER EINSTELLUNGEN</span><h2 id="server-admin-title">{activeServer.name}</h2><p>Mitglieder, Rollen und Einladungen an einem Ort.</p></div><button className="icon-button" aria-label="Schließen" onClick={() => setServerAdminOpen(false)}><X size={18} /></button></div>
            <nav className="server-admin-tabs" aria-label="Serververwaltung">
              {(serverPermissions.manage_roles || serverPermissions.kick_members || serverPermissions.manage_server) && <button className={serverAdminTab === 'members' ? 'active' : ''} onClick={() => setServerAdminTab('members')}><UsersRound size={15} /> Mitglieder</button>}
              {serverPermissions.manage_roles && <button className={serverAdminTab === 'roles' ? 'active' : ''} onClick={() => setServerAdminTab('roles')}><ShieldCheck size={15} /> Rollen</button>}
              {serverPermissions.manage_invites && <button className={serverAdminTab === 'invites' ? 'active' : ''} onClick={() => setServerAdminTab('invites')}><UserPlus size={15} /> Einladungen</button>}
            </nav>
            {serverAdminTab === 'members' && <div className="server-admin-content">
              <div className="server-admin-section-title"><div><b>Servermitglieder</b><small>Rollen gelten nur für diesen Server.</small></div><span>{serverMembers.length}</span></div>
              {serverMembers.map((member) => <div className="server-admin-member" key={member.id}>
                <Avatar name={member.username} online={member.online} />
                <span className="server-admin-member-name"><b>{member.username}{member.id === user.id ? ' (du)' : ''}</b><small>{member.role_name || 'Mitglied'}</small></span>
                {member.id !== user.id && member.role_name !== 'Owner' && serverPermissions.manage_roles && <select className="server-role-select" aria-label={`Rolle für ${member.username}`} value={member.role_id || ''} onChange={(event) => changeServerMemberRole(member.id, event.target.value)}>
                  {serverRoles.filter((role) => role.name !== 'Owner').map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>}
                {member.id !== user.id && serverPermissions.kick_members && member.role_name !== 'Owner' && <button className="icon-button server-remove-member" title="Mitglied entfernen" aria-label={`${member.username} entfernen`} onClick={() => removeServerMember(member)}><UserX size={16} /></button>}
              </div>)}
            </div>}
            {serverAdminTab === 'roles' && serverPermissions.manage_roles && <div className="server-admin-content server-role-content">
              <div className="server-admin-section-title"><div><b>Rollen & Berechtigungen</b><small>Systemrollen sind geschützt; eigene Rollen lassen sich bearbeiten.</small></div><span>{serverRoles.length}</span></div>
              <div className="server-role-list">{serverRoles.map((role) => <div className={`server-role-row ${roleDraft?.id === role.id ? 'editing' : ''}`} key={role.id}>
                <span className="server-role-color" style={{ background: role.color || '#818cf8' }} /><span><b>{role.name}</b><small>{role.isSystem ? 'Systemrolle' : `${Object.values(role.permissions || {}).filter(Boolean).length} Berechtigungen`}</small></span>
                {!role.isSystem && <><button className="icon-button" title="Rolle bearbeiten" onClick={() => setRoleDraft({ ...role, permissions: { ...role.permissions } })}><Settings2 size={15} /></button><button className="icon-button server-remove-member" title="Rolle löschen" onClick={() => deleteServerRole(role)}><Trash2 size={15} /></button></>}
              </div>)}</div>
              {roleDraft && <form className="server-role-editor" onSubmit={saveServerRole}>
                <div className="server-role-editor-heading"><b>Rolle bearbeiten</b><button type="button" className="icon-button" aria-label="Bearbeitung schließen" onClick={() => setRoleDraft(null)}><X size={15} /></button></div>
                <div className="server-role-fields"><label className="field"><span>Name</span><input className="plain-input" value={roleDraft.name} onChange={(event) => setRoleDraft((current) => ({ ...current, name: event.target.value }))} minLength="2" maxLength="32" required /></label><label className="field"><span>Farbe</span><input type="color" value={roleDraft.color || '#818cf8'} onChange={(event) => setRoleDraft((current) => ({ ...current, color: event.target.value }))} /></label></div>
                <div className="server-permission-grid">{SERVER_PERMISSION_LABELS.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(roleDraft.permissions[key])} onChange={(event) => setRoleDraft((current) => ({ ...current, permissions: { ...current.permissions, [key]: event.target.checked } }))} />{label}</label>)}</div>
                <button className="button button-primary">Änderungen speichern</button>
              </form>}
              <form className="server-role-editor server-new-role" onSubmit={createServerRole}>
                <b>Neue Rolle anlegen</b>
                <div className="server-role-fields"><label className="field"><span>Name</span><input className="plain-input" value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} minLength="2" maxLength="32" placeholder="z. B. Moderator" required /></label><label className="field"><span>Farbe</span><input type="color" value={newRoleColor} onChange={(event) => setNewRoleColor(event.target.value)} /></label></div>
                <div className="server-permission-grid">{SERVER_PERMISSION_LABELS.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(newRolePermissions[key])} onChange={(event) => setNewRolePermissions((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div>
                <button className="button button-dark">Rolle erstellen</button>
              </form>
            </div>}
            {serverAdminTab === 'invites' && serverPermissions.manage_invites && <div className="server-admin-content">
              <div className="server-admin-section-title"><div><b>Einladungslink</b><small>Teile den Link, damit andere beitreten können.</small></div><UserPlus size={18} /></div>
              {serverInvite ? <div className="server-invite-card">
                <div className="server-invite-url"><Link2 size={16} /><span>{serverInvite.url}</span><button className="icon-button" title="Link kopieren" aria-label="Link kopieren" onClick={copyServerInvite}><Copy size={15} /></button></div>
                <p>{serverInvite.useCount || 0} Beitritte{serverInvite.expiresAt ? ` · läuft ab ${new Date(serverInvite.expiresAt).toLocaleDateString()}` : ' · kein Ablaufdatum'}</p>
                <div className="server-invite-actions"><button className="button button-dark" onClick={copyServerInvite}>{copiedInvite ? <Check size={15} /> : <Copy size={15} />}{copiedInvite ? 'Kopiert' : 'Link kopieren'}</button><button className="button button-danger" onClick={revokeServerInvite}>Ungültig machen</button></div>
              </div> : <div className="server-invite-empty"><span><UserPlus size={20} /></span><b>Kein aktiver Einladungslink</b><p>Bestimme, wie lange und wie oft der Link genutzt werden kann.</p>
                <div className="server-invite-options">
                  <label className="field"><span>Gültigkeit</span><select className="plain-input" value={inviteExpiry} onChange={(event) => setInviteExpiry(event.target.value)}><option value="">Unbegrenzt</option><option value="1">1 Stunde</option><option value="24">24 Stunden</option><option value="168">7 Tage</option><option value="720">30 Tage</option></select></label>
                  <label className="field"><span>Nutzungen</span><select className="plain-input" value={inviteMaxUses} onChange={(event) => setInviteMaxUses(event.target.value)}><option value="">Unbegrenzt</option><option value="1">1 Person</option><option value="5">5 Personen</option><option value="10">10 Personen</option><option value="50">50 Personen</option></select></label>
                </div>
                <button className="button button-primary" onClick={createServerInvite}>Einladung erstellen <ArrowRight size={15} /></button></div>}
            </div>}
            {activeServer?.owner_id !== user.id && <button className="button button-danger server-admin-leave" onClick={leaveServer}>Server verlassen</button>}
          </section>
        </div>}
        {(info || (error && !selected)) && <div className={`workspace-toast ${error ? 'toast-error' : ''}`} role={error ? 'alert' : 'status'}>{error || info}<button aria-label="Hinweis schließen" onClick={() => { setInfo(''); setError(''); }}><X size={15} /></button></div>}
        {incomingToast && <aside className="message-toast" role="status" aria-live="polite">
          <button className="message-toast-open" onClick={() => selectNotificationItem(incomingToast)}>
            <span className={`notification-item-mark ${incomingToast.kind === 'channel' ? 'channel' : ''}`}>{incomingToast.kind === 'channel' ? <Hash size={16} /> : <MessageCircle size={16} />}</span>
            <span><b>{incomingToast.sender} · {incomingToast.kind === 'channel' ? `#${incomingToast.name}` : incomingToast.name}</b><small>{incomingToast.preview}</small></span>
          </button>
          <button className="message-toast-dismiss" aria-label="Benachrichtigung schließen" onClick={() => setIncomingToast(null)}><X size={15} /></button>
        </aside>}
        {/* ── Incoming Call Ringing Popup (Discord-Style) ── */}
        {incomingCall && (
          <div className="incoming-call-modal">
            <Avatar name={incomingCall.fromUsername || '?'} size="large" />
            <div className="incoming-call-info">
              <h4>@{incomingCall.fromUsername} ruft an…</h4>
              <p>{incomingCall.isScreenShare ? 'Teilt Bildschirm' : incomingCall.withVideo ? 'Videoanruf' : 'Sprachanruf'}</p>
            </div>
            <div className="incoming-call-actions">
              <button className="btn-call-accept" title="Annehmen" aria-label="Annehmen" onClick={acceptCall}>
                <Phone size={20} />
              </button>
              <button className="btn-call-reject" title="Ablehnen" aria-label="Ablehnen" onClick={rejectCall}>
                <PhoneOff size={20} />
              </button>
            </div>
          </div>
        )}
        <footer className="main-footer"><span>mingle <span>·</span> In Verbindung, ganz bei dir.</span><button onClick={onThemeToggle}>{theme === 'light' ? <Moon size={13} /> : <Sun size={13} />} Design wechseln</button></footer>
      </section>
    </main>
  );
}

function InvitePage({ code, session, token, onToken, theme, joinPending, onRequestJoin, onJoined, onCancelPending }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    let active = true;
    attempted.current = false;
    setLoading(true);
    setError('');
    setPreview(null);
    request(`/servers/invites/${encodeURIComponent(code)}`)
      .then((result) => { if (active) setPreview(result); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  const join = useCallback(async () => {
    if (!session || joining) return;
    setJoining(true);
    setError('');
    try {
      const result = await request(`/servers/invites/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        token,
        onToken
      });
      onJoined(result.serverId);
    } catch (requestError) {
      setError(requestError.message);
      onCancelPending?.();
    } finally {
      setJoining(false);
    }
  }, [code, joining, onCancelPending, onJoined, onToken, session, token]);

  useEffect(() => {
    if (joinPending && session && preview && !attempted.current) {
      attempted.current = true;
      join();
    }
  }, [join, joinPending, preview, session]);

  const serverIcon = preview?.server?.iconUrl || preview?.server?.icon_url || '';
  const serverMark = serverIcon.startsWith('emoji:')
    ? serverIcon.slice(6)
    : serverIcon
      ? <img src={serverIcon} alt="" />
      : <UsersRound size={28} />;

  return <main className={`invite-page ${theme}`}>
    <header className="invite-brand"><Brand /><span>MINGLE COMMUNITY</span></header>
    <section className="invite-card" aria-live="polite">
      <div className="invite-emblem">{serverMark}</div>
      <span className="auth-kicker">DU BIST EINGELADEN</span>
      {loading ? <><h1>Einladung wird geprüft</h1><p>Wir schauen nach, wohin der Link führt.</p><span className="loader" /></> : error && !preview ? <><h1>Einladung nicht verfügbar</h1><p>{error}</p></> : preview ? <>
        <h1>{preview.server.name}</h1>
        <p>Du wurdest eingeladen, dieser Mingle-Community beizutreten.</p>
        <div className="invite-server-meta"><span><UsersRound size={16} /> {preview.server.memberCount} Mitglieder</span><span><ShieldCheck size={16} /> Mingle-Server</span></div>
        {error && <div className="form-message error" role="alert">{error}</div>}
        <button className="button button-primary invite-join-button" onClick={() => session ? join() : onRequestJoin()} disabled={joining || loading}>
          {joining ? 'Server wird geöffnet …' : session ? 'Server beitreten' : 'Anmelden & beitreten'} <ArrowRight size={17} />
        </button>
        {!session && <small className="invite-auth-note">Nach der Anmeldung setzen wir deinen Beitritt hier fort.</small>}
      </> : null}
    </section>
    <footer className="invite-footer">Mingle <span>·</span> Gespräche, die zusammenbringen.</footer>
  </main>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [showLanding, setShowLanding] = useState(!window.electronAPI && window.location.pathname === '/');
  const [theme, setTheme] = useState(() => window.localStorage.getItem('mingle-theme') || 'light');
  const [page, setPage] = useState(window.location.pathname);
  const [inviteAuthRequired, setInviteAuthRequired] = useState(false);
  const [inviteJoinPending, setInviteJoinPending] = useState(false);
  const [joinedServerId, setJoinedServerId] = useState(null);
  const refreshStarted = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('mingle-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setPage(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (page === '/verify-email' || page === '/reset-password') {
      setChecking(false);
      return;
    }
    if (refreshStarted.current) return;
    refreshStarted.current = true;
    request('/auth/refresh', { method: 'POST' })
      .then((result) => setSession(result))
      .catch(() => setSession(null))
      .finally(() => setChecking(false));
  }, [page]);

  function goToLogin() {
    window.history.replaceState({}, '', '/');
    setPage('/');
    setAuthMode('login');
  }

  function openInvite(code) {
    const invitePath = `/invite/${encodeURIComponent(code)}`;
    window.history.pushState({}, '', invitePath);
    setPage(invitePath);
    setShowLanding(false);
    setInviteJoinPending(false);
    setInviteAuthRequired(false);
  }

  function completeServerJoin(serverId) {
    window.history.replaceState({}, '', '/');
    setPage('/');
    setJoinedServerId(serverId);
    setInviteJoinPending(false);
    setInviteAuthRequired(false);
  }

  function logout() {
    const activeToken = session?.accessToken;
    request('/auth/logout', { method: 'POST', token: activeToken })
      .catch((error) => console.error('Die Sitzung konnte serverseitig nicht widerrufen werden:', error));
    setSession(null);
    goToLogin();
  }

  if (checking) {
    return <main className="loading-screen"><Brand /><span className="loader" /><p>Dein sicherer Raum wird vorbereitet …</p></main>;
  }
  if (page === '/verify-email') return <VerifyPage onBack={goToLogin} />;
  if (page === '/reset-password') return <ResetPasswordPage onBack={goToLogin} />;
  const inviteMatch = page.match(/^\/invite\/([^/]+)\/?$/);
  if (inviteMatch && inviteAuthRequired && !session) {
    return <AuthPage initialMode={authMode} onSession={(nextSession) => { setSession(nextSession); setInviteAuthRequired(false); }} onBackToLanding={() => setInviteAuthRequired(false)} />;
  }
  if (inviteMatch) {
    return <InvitePage
      code={decodeURIComponent(inviteMatch[1])}
      session={session}
      token={session?.accessToken}
      onToken={(accessToken) => setSession((current) => current ? { ...current, accessToken } : current)}
      theme={theme}
      joinPending={inviteJoinPending}
      onRequestJoin={() => { setAuthMode('login'); setInviteJoinPending(true); setInviteAuthRequired(true); }}
      onJoined={completeServerJoin}
      onCancelPending={() => setInviteJoinPending(false)}
    />;
  }
  if (showLanding && !session) {
    return (
      <LandingPage
        onOpenApp={() => setShowLanding(false)}
        onOpenLogin={() => { setAuthMode('login'); setShowLanding(false); }}
        onOpenRegister={() => { setAuthMode('register'); setShowLanding(false); }}
      />
    );
  }
  if (!session) return <AuthPage initialMode={authMode} onSession={setSession} onBackToLanding={() => setShowLanding(true)} />;
  return (
    <ChatWorkspace
      user={session.user}
      token={session.accessToken}
      onUserChange={(user) => setSession((current) => ({ ...current, user }))}
      onToken={(accessToken) => setSession((current) => ({ ...current, accessToken }))}
      onLogout={logout}
      theme={theme}
      onThemeToggle={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
      onOpenInvite={openInvite}
      initialServerId={joinedServerId}
      onInitialServerSelected={() => setJoinedServerId(null)}
    />
  );
}
