import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Download,
  FileText,
  LockKeyhole,
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
  Search,
  Send,
  Settings,
  ShieldCheck,
  SmilePlus,
  Sun,
  Trash2,
  UserRound,
  UserPlus,
  UserX,
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

function MessageAttachment({ attachment, token, onToken }) {
  const [url, setUrl] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const attachmentRef = useRef(null);
  const isImage = attachment.mimeType.startsWith('image/');
  const sizeLabel = attachment.size < 1024 * 1024
    ? `${Math.max(1, Math.round(attachment.size / 1024))} KB`
    : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`;

  useEffect(() => {
    if (!isImage) return undefined;
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
  }, [attachment.id, attachment.url, isImage, token, onToken]);

  if (isImage) {
    if (loadError) return <p className="attachment-error">{loadError}</p>;
    return <a className="attachment-image-link" href={url} target="_blank" rel="noreferrer">
      <span className="attachment-image-preview" ref={attachmentRef}>
        {url ? <img className="attachment-image" src={url} alt={attachment.name} /> : <span>{loading ? 'Bild wird geladen …' : 'Bildvorschau'}</span>}
      </span>
      <span>{attachment.name} <small>{sizeLabel}</small></span>
    </a>;
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

function AuthPage({ onSession, initialMode = 'login', onBackToLanding }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ email: '', password: '', username: '', age: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [canResendVerification, setCanResendVerification] = useState(false);
  const [twoFactor, setTwoFactor] = useState(null);
  const [totpCode, setTotpCode] = useState('');

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
    try {
      if (mode === 'register') {
        const result = await request('/auth/register', {
          method: 'POST',
          body: { email: form.email, password: form.password, username: form.username, age: Number(form.age) }
        });
        setNotice(result.message);
        // Only show resend button if email verification is actually required
        const needsVerification = result.message.includes('bestätige') || result.message.includes('Postfach');
        setCanResendVerification(needsVerification);
        if (!needsVerification) {
          // Auto-verified – switch to login so user can log in immediately
          setTimeout(() => setMode('login'), 1500);
        }
      } else if (mode === 'forgot') {
        const result = await request('/auth/forgot-password', { method: 'POST', body: { email: form.email } });
        setNotice(result.message);
      } else {
        const result = await request('/auth/login', {
          method: 'POST',
          body: { identifier: form.email, password: form.password }
        });
        if (result.twoFactorRequired) {
          setTwoFactor({ tempToken: result.tempToken });
          setTotpCode('');
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
    try {
      const result = await request('/auth/2fa/verify', {
        method: 'POST',
        body: { tempToken: twoFactor.tempToken, code: totpCode }
      });
      onSession(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === 'register';
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
              <h2>Code eingeben</h2>
              <p>Öffne deine Authenticator-App und gib den 6-stelligen Code ein.</p>
            </div>
            <form className="auth-form" onSubmit={verifyTotp}>
              <label className="field">
                <span>Authenticator-Code</span>
                <div className="input-wrap"><ShieldCheck size={17} /><input name="totpCode" value={totpCode} onChange={(e) => { setTotpCode(e.target.value); setError(''); }} placeholder="000 000" maxLength="7" autoComplete="one-time-code" inputMode="numeric" autoFocus required /></div>
              </label>
              {error && <div className="form-message error" role="alert">{error}</div>}
              <button className="button button-primary auth-submit" type="submit" disabled={busy}>
                {busy ? 'Wird überprüft …' : 'Bestätigen'}
                {!busy && <ArrowRight size={17} />}
              </button>
            </form>
            <div className="auth-links">
              <button className="text-button" onClick={() => { setTwoFactor(null); setError(''); setTotpCode(''); }}><ArrowLeft size={15} /> Zurück zur Anmeldung</button>
            </div>
            <div className="auth-assurance"><ShieldCheck size={16} /><span>Der Code wird von deiner Authenticator-App generiert.</span></div>
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
            <span className="auth-kicker">{isRegister ? 'SCHÖN, DASS DU DA BIST' : isForgot ? 'KEIN PROBLEM' : 'WILLKOMMEN ZURÜCK'}</span>
            <h2>{isRegister ? 'Dein Konto. Dein Raum.' : isForgot ? 'Passwort zurücksetzen' : 'Melde dich an.'}</h2>
            <p>{isRegister ? 'Ein paar Angaben, dann kann es losgehen.' : isForgot ? 'Wir schicken dir einen Link zum Zurücksetzen.' : 'Deine Gespräche warten schon auf dich.'}</p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {isRegister && (
              <label className="field">
                <span>Benutzername</span>
                <div className="input-wrap"><UserRound size={17} /><input name="username" value={form.username} onChange={update} placeholder="z. B. alex_7" minLength="3" maxLength="20" autoComplete="username" required /></div>
                <small>3–20 Zeichen, Buchstaben, Zahlen oder _</small>
              </label>
            )}
            <label className="field">
              <span>{isRegister || isForgot ? 'E-Mail-Adresse' : 'E-Mail oder Benutzername'}</span>
              <div className="input-wrap"><span className="input-at">@</span><input name="email" value={form.email} onChange={update} placeholder={isRegister || isForgot ? 'du@beispiel.de' : 'Dein Login'} autoComplete="username" required /></div>
            </label>
            {!isForgot && (
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
              {busy ? 'Einen Moment …' : isRegister ? 'Konto erstellen' : isForgot ? 'Link anfordern' : 'Anmelden'}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          {canResendVerification && <button
            className="text-button resend-verification"
            type="button"
            disabled={busy}
            onClick={resendVerification}
          >{busy ? 'Wird versendet …' : 'Bestätigungslink erneut senden'}</button>}

          <div className="auth-links">
            {mode === 'login' && <button className="text-button" onClick={() => { setMode('forgot'); setNotice(''); setError(''); }}>Passwort vergessen?</button>}
            {mode === 'forgot' && <button className="text-button" onClick={() => { setMode('login'); setNotice(''); setError(''); }}><ArrowLeft size={15} /> Zurück zur Anmeldung</button>}
            <div className="auth-switch">
              {isRegister ? 'Schon ein Konto?' : 'Noch kein Konto?'}
              <button className="text-button" onClick={() => { setMode(isRegister ? 'login' : 'register'); setNotice(''); setError(''); }}>
                {isRegister ? 'Anmelden' : 'Jetzt registrieren'}
              </button>
            </div>
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

function SettingsPage({ user, token, onUserChange, onToken, onLogout }) {
  const [username, setUsername] = useState(user.username);
  const [age, setAge] = useState(String(user.age));
  const [profileTotpCode, setProfileTotpCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordTotpCode, setPasswordTotpCode] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailTotpCode, setEmailTotpCode] = useState('');

  const [deletePassword, setDeletePassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [totpSetup, setTotpSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');

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
      onUserChange(result.user);
      setProfileTotpCode('');
      setMessage('Dein Profil wurde aktualisiert.');
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
      const body = { newEmail, password: emailPassword };
      if (user.totpEnabled) {
        body.totpCode = emailTotpCode;
      }
      const result = await request('/auth/change-email', {
        method: 'POST',
        token,
        onToken,
        body
      });
      if (result.user) onUserChange(result.user);
      else onUserChange({ ...user, email: newEmail });
      setMessage(result.message || 'E-Mail-Adresse erfolgreich geändert.');
      setNewEmail('');
      setEmailPassword('');
      setEmailTotpCode('');
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
      await request('/auth/change-password', {
        method: 'POST',
        token,
        onToken,
        body
      });
      setMessage('Passwort geändert. Bitte melde dich erneut an.');
      setCurrentPassword('');
      setNewPassword('');
      setPasswordTotpCode('');
      window.setTimeout(onLogout, 900);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(event) {
    event.preventDefault();
    if (!window.confirm('Dein Konto und deine Profildaten werden dauerhaft gelöscht. Möchtest du fortfahren?')) return;
    setBusy(true);
    setError('');
    try {
      await request('/auth/me', { method: 'DELETE', token, onToken, body: { password: deletePassword } });
      onLogout();
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
      <section className="settings-card">
        <div className="settings-card-title"><span className="settings-icon"><UserRound size={18} /></span><div><h2>Profil &amp; Benutzername</h2><p>Passe deinen Benutzernamen an.</p></div></div>
        <form className="settings-form" onSubmit={saveProfile}>
          <label className="field"><span>Aktuelle E-Mail</span><input className="plain-input readonly" value={user.email} readOnly /></label>
          <div className="settings-fields">
            <label className="field"><span>Benutzername</span><input className="plain-input" value={username} onChange={(event) => setUsername(event.target.value)} minLength="3" maxLength="20" required /></label>
            <label className="field"><span>Alter</span><input className="plain-input" type="number" value={age} onChange={(event) => setAge(event.target.value)} min="13" max="120" required /></label>
          </div>
          {user.totpEnabled && username !== user.username && (
            <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:10,padding:'12px 14px',margin:'10px 0'}}>
              <p style={{fontSize:'0.85rem',fontWeight:700,color:'#818cf8',margin:'0 0 6px',display:'flex',alignItems:'center',gap:6}}>
                <ShieldCheck size={15}/> 2FA-Sicherheitsabfrage für Namensänderung
              </p>
              <label className="field"><span>6-stelliger Authenticator-Code</span><input className="plain-input" value={profileTotpCode} onChange={(e)=>setProfileTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
            </div>
          )}
          <button className="button button-dark" disabled={busy}>Änderungen speichern</button>
        </form>
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><span className="settings-icon blue"><ShieldCheck size={18} /></span><div><h2>E-Mail-Adresse ändern</h2><p>Aktuelle E-Mail: <b>{user.email}</b></p></div></div>
        <form className="settings-form" onSubmit={changeEmail}>
          <label className="field"><span>Neue E-Mail-Adresse</span><input className="plain-input" type="email" value={newEmail} onChange={(e)=>setNewEmail(e.target.value)} placeholder="neu@beispiel.de" required /></label>
          <label className="field"><span>Aktuelles Passwort bestätigen</span><input className="plain-input" type="password" value={emailPassword} onChange={(e)=>setEmailPassword(e.target.value)} autoComplete="current-password" required /></label>
          {user.totpEnabled && (
            <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:10,padding:'12px 14px',margin:'10px 0'}}>
              <p style={{fontSize:'0.85rem',fontWeight:700,color:'#818cf8',margin:'0 0 6px',display:'flex',alignItems:'center',gap:6}}>
                <ShieldCheck size={15}/> 2FA-Sicherheitsabfrage für E-Mail-Änderung
              </p>
              <label className="field"><span>6-stelliger Authenticator-Code</span><input className="plain-input" value={emailTotpCode} onChange={(e)=>setEmailTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
            </div>
          )}
          <button className="button button-dark" disabled={busy}>E-Mail aktualisieren</button>
        </form>
      </section>
      <section className="settings-card">
        <div className="settings-card-title"><span className="settings-icon mint"><LockKeyhole size={18} /></span><div><h2>Passwort ändern</h2><p>Wir melden dich nach der Änderung auf allen Geräten ab.</p></div></div>
        <form className="settings-form" onSubmit={changePassword}>
          <label className="field"><span>Aktuelles Passwort</span><input className="plain-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
          <label className="field"><span>Neues Passwort</span><input className="plain-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength="8" maxLength="128" autoComplete="new-password" required /></label>
          {user.totpEnabled && (
            <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:10,padding:'12px 14px',margin:'10px 0'}}>
              <p style={{fontSize:'0.85rem',fontWeight:700,color:'#818cf8',margin:'0 0 6px',display:'flex',alignItems:'center',gap:6}}>
                <ShieldCheck size={15}/> 2FA-Sicherheitsabfrage für Passwortänderung
              </p>
              <label className="field"><span>6-stelliger Authenticator-Code</span><input className="plain-input" value={passwordTotpCode} onChange={(e)=>setPasswordTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
            </div>
          )}
          <button className="button button-dark" disabled={busy}>Passwort aktualisieren</button>
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
                const result = await request('/auth/2fa/enable', { method: 'POST', token, onToken, body: { code: totpCode } });
                setMessage(result.message);
                setTotpSetup(null); setTotpCode('');
                onUserChange(result.user || { ...user, totpEnabled: true });
              } catch (e) { setError(e.message); } finally { setBusy(false); }
            }}>
              <label className="field"><span>6-stelliger Code aus der App</span><input className="plain-input" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="000 000" maxLength="7" inputMode="numeric" autoComplete="one-time-code" required /></label>
              <button className="button button-dark" disabled={busy}>{busy ? 'Wird überprüft …' : '2FA aktivieren'}</button>
            </form>
          </div>
        )}
        {user.totpEnabled && (
          <form className="settings-form" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setError(''); setMessage('');
            try {
              const result = await request('/auth/2fa/disable', { method: 'POST', token, onToken, body: { password: disablePassword } });
              setMessage(result.message); setDisablePassword('');
              onUserChange(result.user || { ...user, totpEnabled: false });
            } catch (e) { setError(e.message); } finally { setBusy(false); }
          }}>
            <label className="field"><span>Passwort bestätigen</span><input className="plain-input" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} autoComplete="current-password" required /></label>
            <button className="button button-danger" disabled={busy}>2FA deaktivieren</button>
          </form>
        )}
      </section>
      <section className="settings-card danger-card">
        <div className="settings-card-title"><span className="settings-icon rose"><X size={18} /></span><div><h2>Konto löschen</h2><p>Diese Aktion kann nicht rückgängig gemacht werden.</p></div></div>
        <form className="delete-row" onSubmit={deleteAccount}>
          <label className="field"><span>Mit Passwort bestätigen</span><input className="plain-input" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" required /></label>
          <button className="button button-danger" disabled={busy}>Konto dauerhaft löschen</button>
        </form>
      </section>
    </div>
  );
}

function messageTime(value) {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

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

function ChatWorkspace({ user, token, onUserChange, onToken, onLogout, theme, onThemeToggle }) {
  const [section, setSection] = useState('chats');
  const [mobileMenu, setMobileMenu] = useState(false);
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

  useEffect(() => {
    refreshLists().catch((requestError) => setError(requestError.message));
  }, [refreshLists]);

  useEffect(() => {
    const socket = io({ path: '/socket.io', auth: { token } });
    socketRef.current = socket;
    let refreshingSocket = false;
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
      setConversations((current) => current.map((conversation) => conversation.id === message.conversationId
        ? {
            ...conversation,
            lastMessage: message.body || (message.attachment ? `📎 ${message.attachment.name}` : ''),
            lastMessageAt: message.createdAt,
            unreadCount: message.senderId === user.id || selectedIdRef.current === message.conversationId
              ? 0
              : conversation.unreadCount + 1
          }
        : conversation));
      if (selectedIdRef.current === message.conversationId) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (message.senderId !== user.id) {
          request(`/conversations/${message.conversationId}/read`, { method: 'POST', token, onToken })
            .catch((requestError) => setError(requestError.message));
        }
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
  }, [token, user.id, onToken, refreshLists, callPeerUser]);

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
      setError('Mikrofon-/Kamerazugriff wurde verweigert oder abgebrochen.');
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
      setError('Zugriff auf Audio/Video fehlgeschlagen.');
      rejectCall();
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

  const selected = conversations.find((item) => item.id === selectedId) || null;
  const conversationQuery = search.trim().toLocaleLowerCase();
  const visibleConversations = conversations.filter((item) => !conversationQuery
    || (item.name || '').toLocaleLowerCase().includes(conversationQuery)
    || (item.lastMessage || '').toLocaleLowerCase().includes(conversationQuery));

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
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']);
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
    <main className={`workspace ${theme}`}>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <button className="icon-button mobile-menu-close" aria-label="Menü schließen" onClick={() => setMobileMenu(false)}><X size={19} /></button>
          <button className="icon-button more-button" aria-label="Abmelden" title="Abmelden" onClick={onLogout}><LogOut size={17} /></button>
        </div>
        <div className="sidebar-greeting"><span>DEIN MESSENGER</span><h1>Hallo, {user.username} <span className="wave">✦</span></h1><p>{friendships.incoming.length ? `${friendships.incoming.length} neue Anfrage${friendships.incoming.length === 1 ? '' : 'n'}` : 'Was gibt’s Neues?'}</p></div>
        <div className="sidebar-tabs">
          <button className={section === 'chats' ? 'active' : ''} onClick={() => { setSection('chats'); setMobileMenu(false); }}><MessageCircle size={16} /> Chats</button>
          <button className={section === 'contacts' ? 'active' : ''} onClick={() => { setSection('contacts'); setMobileMenu(false); }}><UsersRound size={16} /> Kontakte{friendships.incoming.length > 0 && <i className="tab-count">{friendships.incoming.length}</i>}</button>
          <button className={settingsVisible ? 'active' : ''} onClick={() => { setSection('settings'); setMobileMenu(false); }}><Settings size={16} /> Konto</button>
        </div>
        {section === 'chats' && (
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
          <div className="topbar-context"><span className={`context-dot ${selected?.peer?.online ? '' : 'offline'}`} /><span>{settingsVisible ? 'Dein Konto' : selected ? selected.name : section === 'contacts' ? 'Kontakte' : 'Deine Nachrichten'}</span></div>
          <div className="topbar-actions">
            {selected?.peer && <span className="presence-label">{typing ? 'schreibt gerade…' : selected.peer.online ? 'online' : 'offline'}</span>}
            <span className="secure-label"><ShieldCheck size={15} /> Sicher verbunden</span>
            {selected?.peer && <button className="icon-button block-button" title="Kontakt blockieren" aria-label="Kontakt blockieren" onClick={() => blockUser(selected.peer)}><Ban size={17} /></button>}
            <button className="icon-button theme-toggle" onClick={onThemeToggle} title={theme === 'light' ? 'Dunkles Design' : 'Helles Design'} aria-label="Design wechseln">{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
          </div>
        </header>
        {settingsVisible ? (
          <SettingsPage user={user} token={token} onUserChange={onUserChange} onToken={onToken} onLogout={onLogout} />
        ) : selected ? (
          <section className="chat-room">
            <div className="chat-room-header">
              <Avatar name={selected.name || 'Gruppe'} online={selected.peer?.online} />
              <div><h2>{selected.name}</h2><p>{typing ? `${typing} schreibt gerade…` : selected.peer?.online ? 'online' : selected.type === 'group' ? 'Gruppenunterhaltung' : 'zuletzt gesehen'}</p></div>
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
            <div className="message-list">
              {messages.length === 0 && <div className="conversation-start"><Avatar name={selected.name || 'Gruppe'} size="large" online={selected.peer?.online} /><h3>Das ist euer Anfang.</h3><p>Schick {selected.peer ? `@${selected.peer.username}` : 'der Gruppe'} die erste Nachricht.</p></div>}
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
            <form className="composer" onSubmit={sendMessage}>
              {replyTo && <div className="replying-to"><span><b>Antwort an {replyTo.senderUsername || 'dich'}</b><small>{replyTo.body}</small></span><button type="button" aria-label="Antwort abbrechen" onClick={() => setReplyTo(null)}><X size={15} /></button></div>}
              {pendingFile && <div className="pending-attachment"><Paperclip size={14} /><span>{pendingFile.name}<small>{(pendingFile.size / (1024 * 1024)).toFixed(1)} MB</small></span><button type="button" aria-label="Dateianhang entfernen" onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}><X size={15} /></button></div>}
              <div className="composer-row">
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain" onChange={chooseAttachment} />
                <button className="icon-button attachment-button" type="button" title="Bild oder Datei anhängen" aria-label="Bild oder Datei anhängen" onClick={() => fileInputRef.current?.click()}><Paperclip size={18} /></button>
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
              <div className="composer-hint">Bilder und Dateien bis 10 MB <span>·</span> Enter zum Senden</div>
            </form>
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
        {(info || (error && !selected)) && <div className={`workspace-toast ${error ? 'toast-error' : ''}`} role={error ? 'alert' : 'status'}>{error || info}<button aria-label="Hinweis schließen" onClick={() => { setInfo(''); setError(''); }}><X size={15} /></button></div>}
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

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [showLanding, setShowLanding] = useState(!window.electronAPI && window.location.pathname === '/');
  const [theme, setTheme] = useState(() => window.localStorage.getItem('mingle-theme') || 'light');
  const [page, setPage] = useState(window.location.pathname);
  const refreshStarted = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('mingle-theme', theme);
  }, [theme]);

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
    />
  );
}
