import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, CalendarDays, CalendarPlus, ClipboardList, Eye, EyeOff, History as HistoryIcon, LayoutDashboard, LockKeyhole, LogOut, Tv, UsersRound } from 'lucide-react';
import { client, explain, loadProfile, loadRooms, rpc } from './api';
import { Field, Loading, Message, Modal, useLoad } from './common';
import { Dashboard, Calendar } from './Overview';
import { Booking } from './Booking';
import { History } from './History';
import { ManageRooms, ManageUsers } from './Admin';
import { TvDisplay } from './TvDisplay';
import { roles } from './domain';
import './style.css';
import departmentLogo from './assets/headped.png';

const commonNav = [
  ['dashboard', 'ภาพรวม', LayoutDashboard],
  ['calendar', 'ปฏิทิน', CalendarDays],
  ['book', 'จองห้อง', CalendarPlus],
  ['history', 'ประวัติการจอง', HistoryIcon],
];
const adminNav = [
  ['queue', 'จัดการคิว', ClipboardList],
  ['rooms', 'ห้องประชุม', Building2],
  ['users', 'ผู้ใช้งาน', UsersRound],
  ['tv', 'จอทีวี', Tv],
];

function Brand() {
  return (
    <div className="brand">
      <img
        className="brand-logo"
        src={departmentLogo}
        alt="ภาควิชากุมารเวชศาสตร์ คณะแพทยศาสตร์ศิริราชพยาบาล มหาวิทยาลัยมหิดล"
        width={397}
        height={105}
      />
      <strong>ระบบจองห้องประชุม</strong>
    </div>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setError('');
    try {
      const { error: failure } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (failure) throw failure;
    } catch (failure) { setError(explain(failure)); }
    finally { setBusy(false); }
  }

  return <main className="auth-page">
    <section className="auth-art" aria-hidden="true">
      <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
      <div className="art-back"><div /><div /><div /></div>
      <div className="art-front"><CalendarDays size={58} strokeWidth={1.45} /><div className="art-grid">
        {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
      </div></div>
    </section>
    <section className="auth-content">
      <div className="auth-card">
        <Brand />
        <h1>เข้าสู่ระบบ</h1>
        <p className="muted">ใช้บัญชีที่ผู้ดูแลระบบจัดเตรียมให้</p>
        <form className="stack" onSubmit={submit}>
          <Field label="อีเมล"><input type="email" autoComplete="username" required value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="example@mahidol.ac.th" /></Field>
          <div className="field">
            <label htmlFor="login-password">รหัสผ่าน</label>
            <div className="password-input">
              <input id="login-password" type={visible ? 'text' : 'password'} autoComplete="current-password"
                value={password} required onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="icon-btn" onClick={() => setVisible(!visible)}
                aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
            </div>
          </div>
          <Message>{error || (!client && 'ยังไม่ได้ตั้งค่า Supabase กรุณาตรวจสอบวิธีตั้งค่าในคู่มือ')}</Message>
          <button className="btn primary" disabled={!client || busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        </form>
      </div>
    </section>
  </main>;
}

function PasswordDialog({ close, onSaved }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (password !== confirmation) return setError('รหัสผ่านที่ยืนยันไม่ตรงกัน');
    if (new TextEncoder().encode(password).length > 72) return setError('รหัสผ่านต้องมีขนาดไม่เกิน 72 ไบต์');
    setError('');
    setBusy(true);
    try {
      const { error: failure } = await client.auth.updateUser({ password });
      if (failure) throw failure;
      onSaved();
    } catch (failure) { setError(explain(failure)); }
    finally { setBusy(false); }
  }
  return <Modal title="เปลี่ยนรหัสผ่าน" onClose={() => !busy && close()}>
    <form className="stack" onSubmit={submit}>
      <Field label="รหัสผ่านใหม่"><input type="password" autoComplete="new-password" value={password}
        minLength={12} required onChange={(e) => setPassword(e.target.value)} disabled={busy} /></Field>
      <Field label="ยืนยันรหัสผ่านใหม่"><input type="password" autoComplete="new-password" value={confirmation}
        minLength={12} required onChange={(e) => setConfirmation(e.target.value)} disabled={busy} /></Field>
      <Message>{error}</Message>
      <button className="btn primary" disabled={busy}>บันทึกรหัสผ่าน</button>
    </form>
  </Modal>;
}

function SessionApp({ session }) {
  const [profileRevision, setProfileRevision] = useState(0);
  const profile = useLoad(session.user.id + '/' + profileRevision, () => loadProfile(session.user.id));
  const isAdmin = profile.data?.role === 'admin';
  const [roomRevision, setRoomRevision] = useState(0);
  const rooms = useLoad([session.user.id, profile.data?.role, roomRevision].join('/'), loadRooms, true);
  const [page, setPage] = useState('dashboard');
  const [tvRequested, setTvRequested] = useState(() => window.location.hash === '#tv');
  const isTv = isAdmin && tvRequested;
  const [draft, setDraft] = useState({ key: 0, duplicate: null, prefill: null });
  const [notice, setNotice] = useState('');
  const [signoutError, setSignoutError] = useState('');
  const [password, setPassword] = useState(false);
  const [queue, setQueue] = useState(null);
  const [queueRevision, setQueueRevision] = useState(0);
  const activePage = isAdmin || !adminNav.some(([key]) => key === page) ? page : 'dashboard';

  useEffect(() => {
    const checkHash = () => setTvRequested(window.location.hash === '#tv');
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  useEffect(() => {
    if (!isAdmin || isTv) return;
    let active = true;
    async function load() {
      try {
        const data = await rpc('admin_queue_summary', {});
        if (active) setQueue(data);
      } catch { if (active) setQueue(null); }
    }
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [isAdmin, isTv, queueRevision]);

  function navigate(key) {
    if (key === 'tv') {
      window.location.hash = 'tv';
      setTvRequested(true);
      window.scrollTo(0, 0);
      return;
    }
    setPage(key);
    setNotice('');
    window.scrollTo(0, 0);
  }
  function newBooking(prefill = null, duplicate = null) {
    setDraft((previous) => ({ key: previous.key + 1, duplicate, prefill }));
    navigate('book');
  }
  async function signout() {
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch (failure) { setSignoutError(explain(failure)); }
  }
  if (isTv) return <TvDisplay onClose={() => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setTvRequested(false);
  }} />;

  const menu = isAdmin ? [...commonNav, ...adminNav] : commonNav;
  const needsRooms = ['book', 'queue', 'rooms'].includes(activePage);
  return <div className="app-shell">
    <a className="skip" href="#content">ข้ามไปยังเนื้อหา</a>
    <header className="app-header">
      <div className="topbar">
        <Brand />
        <div className="account">
          {profile.data && <div className="account-text"><strong>{profile.data.full_name || session.user.email}</strong>
            <small>{roles[profile.data.role]}</small></div>}
          <button className="icon-btn" onClick={() => setPassword(true)} aria-label="เปลี่ยนรหัสผ่าน" title="เปลี่ยนรหัสผ่าน"><LockKeyhole size={19} /></button>
          <button className="icon-btn" onClick={signout} aria-label="ออกจากระบบ" title="ออกจากระบบ"><LogOut size={19} /></button>
        </div>
      </div>
    </header>
    <div className="workspace">
      <nav className="navigation" aria-label="เมนูหลัก">
        {menu.map(([key, title, Icon]) => <button key={key} className="nav-item"
          aria-current={activePage === key ? 'page' : undefined} onClick={() => key === 'book' ? newBooking() : navigate(key)}>
          <Icon size={19} /><span>{title}</span>
          {key === 'queue' && queue?.conflicts > 0 && <span className="nav-count" aria-label={'รอสลับห้อง ' + queue.conflicts + ' รายการ'}>{queue.conflicts}</span>}
        </button>)}
      </nav>
      <main id="content" tabIndex={-1} className="content">
        <Message>{signoutError || profile.error}</Message>
        {profile.error && <button className="btn secondary" onClick={() => setProfileRevision((n) => n + 1)}>โหลดโปรไฟล์ใหม่</button>}
        <Message type="success">{notice}</Message>
        {(profile.loading || (profile.data && needsRooms && rooms.loading && !rooms.data)) && <Loading />}
        {profile.data && needsRooms && <Message>{rooms.error}</Message>}
        {profile.data && needsRooms && rooms.error && <button className="btn secondary" onClick={() => setRoomRevision((n) => n + 1)}>โหลดรายชื่อห้องใหม่</button>}
        {profile.data && (!needsRooms || rooms.data) && <>
          {activePage === 'dashboard' && <Dashboard onBook={() => newBooking()} />}
          {activePage === 'calendar' && <Calendar onBook={newBooking} />}
          {activePage === 'book' && <Booking key={draft.key} profile={profile.data} email={session.user.email}
            rooms={rooms.data} duplicate={draft.duplicate} prefill={draft.prefill}
            onComplete={(message) => { navigate('history'); setNotice(message); setQueueRevision((n) => n + 1); }} />}
          {(activePage === 'history' || activePage === 'queue') && <History key={activePage} admin={activePage === 'queue'}
            rooms={rooms.data ?? []} queue={queue} duplicate={(record) => newBooking(null, record)}
            onUpdated={() => setQueueRevision((n) => n + 1)} />}
          {activePage === 'rooms' && <ManageRooms rooms={rooms.data} onUpdated={() => setRoomRevision((n) => n + 1)} />}
          {activePage === 'users' && <ManageUsers onUpdated={(id) => { if (id === session.user.id) setProfileRevision((n) => n + 1); }} />}
        </>}
      </main>
    </div>
    {password && <PasswordDialog close={() => setPassword(false)}
      onSaved={() => { setPassword(false); setNotice('เปลี่ยนรหัสผ่านแล้ว'); }} />}
  </div>;
}

function App() {
  const [session, setSession] = useState(client ? undefined : null);
  useEffect(() => {
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);
  if (session === undefined) return <main className="startup"><Loading /></main>;
  if (!session) return <AuthScreen />;
  return <SessionApp session={session} key={session.user.id} />;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
