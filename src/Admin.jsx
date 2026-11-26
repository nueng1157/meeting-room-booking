import { useState } from 'react';
import { Building2, Edit3, Plus, UserRound, UsersRound } from 'lucide-react';
import { explain, manageUsers, rpc } from './api';
import { Empty, Field, Loading, Message, Modal, PageTitle, Pager, useLoad } from './common';
import { roles } from './domain';

const newRoom = { name: '', capacity: '', equipment: [], is_active: true };
const newUser = { full_name: '', department: '', email: '', role: 'user' };

export function ManageRooms({ rooms, onUpdated }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function open(room) { setError(''); setEditing(room); }

  async function save(method, params) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await rpc(method, params);
      setEditing(null);
      setNotice('บันทึกข้อมูลห้องประชุมแล้ว');
      onUpdated();
    } catch (failure) { setError(explain(failure)); }
    finally { setBusy(false); }
  }

  return <>
    <PageTitle title="จัดการห้องประชุม" subtitle="แก้ไขข้อมูลห้องและกำหนดว่าห้องใดเปิดให้จอง">
      <button className="btn primary" onClick={() => open(newRoom)} disabled={busy}><Plus size={19} /> เพิ่มห้องประชุม</button>
    </PageTitle>
    <Message type="success">{notice}</Message>
    {!editing && <Message>{error}</Message>}
    {rooms.length ? <div className="management-grid">
      {rooms.map((room) => <article key={room.id} className="panel management-card">
        <div className="tile-icon blue"><Building2 size={21} /></div>
        <h2>{room.name}</h2><p className="muted"><UsersRound size={17} /> ความจุ {room.capacity} คน</p>
        <div className="chips">{room.equipment.map((item) => <span key={item}>{item}</span>)}</div>
        <div className="manage-actions">
          <label className="switch">
            <input type="checkbox" role="switch" aria-label={room.name + ' เปิดให้จอง'} checked={room.is_active} disabled={busy}
              onChange={(e) => save('admin_room_set_active', { p_id: room.id, p_active: e.target.checked })} />
            <span aria-hidden="true" />{room.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </label>
          <button className="btn secondary small" disabled={busy} onClick={() => open(room)}><Edit3 size={15} /> แก้ไข</button>
        </div>
      </article>)}
    </div> : <Empty>ยังไม่มีห้องประชุม</Empty>}
    {editing && <Modal title={editing.id ? 'แก้ไขห้องประชุม' : 'เพิ่มห้องประชุม'} onClose={() => !busy && setEditing(null)}>
      <RoomForm room={editing} busy={busy} error={error} onClose={() => setEditing(null)}
        onSave={(value) => save('admin_room_save', { p_room: value })} />
    </Modal>}
  </>;
}

function RoomForm({ room, busy, error, onSave, onClose }) {
  const [value, set] = useState(() => ({ ...room, equipment: room.equipment.join(', ') }));
  return <form onSubmit={(event) => {
    event.preventDefault();
    onSave({ ...value, capacity: Number(value.capacity), equipment: value.equipment.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) });
  }}>
    <fieldset className="stack" disabled={busy}>
      <Field label="ชื่อห้องประชุม"><input required maxLength={180} value={value.name} onChange={(e) => set({ ...value, name: e.target.value })} /></Field>
      <Field label="ความจุ (คน)"><input required type="number" min="1" max="2147483647" step="1" value={value.capacity}
        onChange={(e) => set({ ...value, capacity: e.target.value })} /></Field>
      <Field label="อุปกรณ์ (คั่นแต่ละรายการด้วยเครื่องหมายจุลภาคหรือขึ้นบรรทัดใหม่)">
        <textarea rows={3} value={value.equipment} onChange={(e) => set({ ...value, equipment: e.target.value })} />
      </Field>
      <label className="switch">
        <input type="checkbox" role="switch" checked={value.is_active} onChange={(e) => set({ ...value, is_active: e.target.checked })} />
        <span aria-hidden="true" />เปิดให้จอง
      </label>
    </fieldset>
    <Message>{error}</Message>
    <SaveActions busy={busy} close={onClose} />
  </form>;
}

export function ManageUsers({ onUpdated }) {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const listing = useLoad(page + '/' + refresh, () => manageUsers({ action: 'list', page: page + 1 }));
  const open = (user) => { setError(''); setEditing(user); };

  async function save(value) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await manageUsers({ ...value, action: editing.id ? 'update' : 'create' });
      setEditing(null);
      setNotice('บันทึกบัญชีผู้ใช้งานแล้ว');
      setRefresh((count) => count + 1);
      onUpdated(editing.id);
    } catch (failure) { setError(explain(failure)); }
    finally { setBusy(false); }
  }

  return <>
    <PageTitle title="จัดการผู้ใช้งาน" subtitle="เพิ่มบัญชี เปลี่ยนข้อมูลและกำหนดสิทธิ์การใช้งาน">
      <button className="btn primary" onClick={() => open(newUser)}><Plus size={19} /> เพิ่มผู้ใช้งาน</button>
    </PageTitle>
    <Message type="success">{notice}</Message>
    {listing.loading && <Loading />}
    <Message>{listing.error}</Message>
    {listing.data?.users.length === 0 && <Empty>ไม่มีผู้ใช้งานในหน้านี้</Empty>}
    {Boolean(listing.data?.users.length) && <div className="management-grid">
      {listing.data.users.map((user) => <article key={user.id} className="panel management-card">
        <div className="tile-icon purple"><UserRound size={21} /></div>
        <h2>{user.full_name || user.email}</h2>
        <p>{user.email}</p><p className="muted">{user.department || 'ยังไม่ระบุหน่วยงาน'}</p>
        <div className="manage-actions">
          <span className="group-badge">{roles[user.role]}</span>
          <button className="btn secondary small" onClick={() => open(user)}><Edit3 size={15} /> แก้ไข</button>
        </div>
      </article>)}
    </div>}
    {(page > 0 || listing.data?.hasNext) && <Pager page={page} hasNext={listing.data?.hasNext}
      busy={listing.loading} onChange={setPage} />}
    {editing && <Modal title={editing.id ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งาน'} onClose={() => !busy && setEditing(null)}>
      <UserForm user={editing} busy={busy} error={error} onClose={() => setEditing(null)} onSave={save} />
    </Modal>}
  </>;
}

function UserForm({ user, busy, error, onSave, onClose }) {
  const [value, set] = useState({ ...user, password: '' });
  const [localError, setLocalError] = useState('');
  const change = (event) => set({ ...value, [event.target.name]: event.target.value });
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (new TextEncoder().encode(value.password).length > 72) return setLocalError('รหัสผ่านต้องมีขนาดไม่เกิน 72 ไบต์');
    setLocalError('');
    onSave(value);
  }}>
    <fieldset className="stack" disabled={busy}>
      <Field label="ชื่อ–สกุล"><input value={value.full_name} name="full_name" required maxLength={180} onChange={change} /></Field>
      <Field label="หน่วยงาน"><input value={value.department} name="department" required maxLength={180} onChange={change} /></Field>
      <Field label="อีเมล"><input value={value.email} name="email" type="email" required maxLength={254} onChange={change} /></Field>
      <Field label={user.id ? 'รหัสผ่านใหม่ (เว้นว่างเพื่อใช้รหัสเดิม)' : 'รหัสผ่านเริ่มต้น'}>
        <input value={value.password} name="password" type="password" minLength={12} required={!user.id}
          autoComplete="new-password" onChange={change} />
      </Field>
      <Field label="สิทธิ์ผู้ใช้งาน"><select value={value.role} name="role" onChange={change}>
        {Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></Field>
    </fieldset>
    <Message>{localError || error}</Message>
    <SaveActions busy={busy} close={onClose} />
  </form>;
}

function SaveActions({ busy, close }) {
  return <div className="actions mt-5">
    <button className="btn secondary" type="button" disabled={busy} onClick={close}>กลับ</button>
    <button className="btn primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
  </div>;
}
