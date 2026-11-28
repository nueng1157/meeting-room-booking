import { useState } from 'react';
import { CalendarDays, Check, Copy, Edit3, RefreshCw, Shuffle, XCircle } from 'lucide-react';
import { explain, rpc } from './api';
import { Empty, Field, Loading, Message, Modal, PageTitle, Pager, Status, useLoad } from './common';
import { formatDate, statuses, timeRange } from './domain';
import { EditBooking } from './Booking';

const pageSize = 20;

export function History({ admin = false, rooms, duplicate, queue, onUpdated }) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState(admin ? 'queue' : 'all');
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const listing = useLoad([page, filter, refresh, admin, admin ? queue?.pending : '', admin ? queue?.conflicts : '', admin ? queue?.requests_total : ''].join('/'), () => rpc('booking_history', {
    p_offset: page * pageSize, p_admin: admin, p_filter: filter,
  }));
  const open = (model) => { setError(''); setModal(model); };

  async function mutate(method, params) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await rpc(method, params);
      setModal(null);
      setNotice(typeof result === 'number' ? 'ดำเนินการแล้ว ' + result + ' รายการ' : 'บันทึกการเปลี่ยนแปลงแล้ว');
      setRefresh((value) => value + 1);
      onUpdated?.();
    } catch (failure) { setError(explain(failure)); }
    finally { setBusy(false); }
  }

  return <>
    <PageTitle title={admin ? 'จัดการคิวการจอง' : 'ประวัติการจอง'}
      subtitle={admin ? 'อนุมัติ แก้ไขรายการ และจัดการคำขอที่ต้องสลับห้อง' : 'ติดตามสถานะและคัดลอกรายการเดิมเพื่อจองใหม่'}>
      <button className="btn secondary" onClick={() => setRefresh((value) => value + 1)} disabled={listing.loading}>
        <RefreshCw size={17} /> โหลดข้อมูลใหม่
      </button>
    </PageTitle>
    {admin && queue?.conflicts > 0 && <Message type="warning">มีคำขอรอพิจารณาสลับห้อง {queue.conflicts} รายการ</Message>}
    <Message type="success">{notice}</Message>
    <div className="panel history-panel">
      <div className="history-toolbar">
        <h2>รายการจอง</h2>
        <select aria-label="กรองสถานะ" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}>
          {admin && <option value="queue">คิวที่ต้องพิจารณา</option>}
          <option value="all">ทุกสถานะ</option>
          {Object.entries(statuses).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </div>
      {listing.loading && <Loading />}
      <Message>{listing.error}</Message>
      {listing.data?.length === 0 && <Empty>ไม่มีรายการตามตัวกรองนี้</Empty>}
      <div className="booking-list">
        {listing.data?.slice(0, pageSize).map((booking) => <article key={booking.id} className={'record ' + booking.status}>
          <div className="record-top">
            <div><h3>{booking.room_name}</h3><p><CalendarDays size={16} />{formatDate(booking.booking_date)} · {timeRange(booking)}</p></div>
            <Status value={booking.status} />
          </div>
          <div className="record-body">
            <p>{booking.purpose_other || booking.purpose} · {booking.actual_user}</p>
            {admin && <p className="muted">ผู้จอง {booking.booker_name} · {booking.email} · {booking.phone}</p>}
            {booking.catering.length > 0 && <p className="muted">สวัสดิการ {booking.catering.join(' · ')}</p>}
            {booking.recurring_group_id && <span className="group-badge">
              จองต่อเนื่อง ({booking.group_count} ครั้ง)
            </span>}
          </div>
          <div className="record-actions">
            <button className="btn secondary small" onClick={() => duplicate(booking)}><Copy size={15} /> คัดลอกการจอง</button>
            {admin && <>
              <button className="btn secondary small" onClick={() => open({ kind: 'edit', booking })}><Edit3 size={15} /> แก้ไข</button>
              {booking.status === 'pending' && <button className="btn positive small"
                onClick={() => open({ kind: 'action', action: 'approve', booking })}><Check size={15} /> อนุมัติ</button>}
              {booking.status === 'conflict_pending' && <button className="btn warm small"
                onClick={() => open({ kind: 'swap', booking })}><Shuffle size={15} /> สลับ/ย้ายห้อง</button>}
              {booking.status !== 'cancelled' && <button className="btn danger small"
                onClick={() => open({ kind: 'action', action: 'cancel', booking })}><XCircle size={15} /> ยกเลิก</button>}
            </>}
          </div>
          {admin && booking.recurring_group_id && <details className="batch-actions">
            <summary>จัดการการจองทั้งชุด</summary>
            <div className="actions">
              <button className="btn positive small" onClick={() => open({ kind: 'action', action: 'approve', booking, group: true })}>
                อนุมัติทั้งหมดในชุดนี้</button>
              <button className="btn danger small" onClick={() => open({ kind: 'action', action: 'cancel', booking, group: true })}>
                ยกเลิกทั้งหมดในชุดนี้</button>
            </div>
          </details>}
        </article>)}
      </div>
      {(page > 0 || listing.data?.length > pageSize) && <Pager page={page} hasNext={listing.data?.length > pageSize}
        onChange={setPage} busy={listing.loading} />}
    </div>
    {modal?.kind === 'edit' && <Modal title="แก้ไขรายการจอง" onClose={() => !busy && setModal(null)}>
      <EditBooking booking={modal.booking} rooms={rooms} onClose={() => setModal(null)} busy={busy} error={error}
        onSave={(value) => mutate('admin_edit_booking', {
          p_id: modal.booking.id, p_version: modal.booking.updated_at, p_booking: value,
        })} />
    </Modal>}
    {modal?.kind === 'action' && <Modal title={modal.action === 'approve' ? 'ยืนยันการอนุมัติ' : 'ยืนยันการยกเลิก'}
      onClose={() => !busy && setModal(null)}>
      <p className="muted">{modal.group ? (modal.action === 'approve'
        ? 'อนุมัติคำขอที่รออนุมัติทั้งชุด หากมีคิวชนที่ยังไม่ได้จัดการ ระบบจะคงสถานะเดิมไว้ทุกคำขอ'
        : 'ยกเลิกทุกรายการในชุดนี้ รวมถึงรายการที่อนุมัติแล้ว')
        : modal.booking.room_name + ' · ' + formatDate(modal.booking.booking_date) + ' · ' + timeRange(modal.booking)}</p>
      <Message>{error}</Message>
      <div className="actions mt-5">
        <button className="btn secondary" disabled={busy} onClick={() => setModal(null)}>กลับ</button>
        <button className={'btn ' + (modal.action === 'approve' ? 'primary' : 'danger')} disabled={busy}
          onClick={() => mutate('admin_action', {
            p_action: modal.action, p_id: modal.group ? modal.booking.recurring_group_id : modal.booking.id,
            p_group: Boolean(modal.group),
          })}>{busy ? 'กำลังบันทึก…' : 'ยืนยัน'}</button>
      </div>
    </Modal>}
    {modal?.kind === 'swap' && <Swap booking={modal.booking} onClose={() => !busy && setModal(null)} busy={busy}
      error={error} onSave={(version, moves) => mutate('admin_resolve_conflict', {
        p_id: modal.booking.id, p_version: version, p_moves: moves,
      })} />}
  </>;
}

function Swap({ booking, onClose, busy, error, onSave }) {
  const [selected, setSelected] = useState({});
  const details = useLoad(booking.id, () => rpc('admin_conflict_details', { p_id: booking.id }));
  const blockers = details.data?.blockers ?? [];
  return <Modal title="สลับ/ย้ายห้องและอนุมัติ" onClose={onClose}>
    <p className="muted">{booking.room_name} · {formatDate(booking.booking_date)} · {timeRange(booking)}</p>
    {details.loading && <Loading />}
    <Message>{details.error || error}</Message>
    {details.data && <form className="stack mt-4" onSubmit={(event) => {
      event.preventDefault();
      onSave(details.data.version, blockers.map(({ id, updated_at }) => ({
        id, updated_at, room_id: selected[id],
      })));
    }}>
      {!blockers.length && <p>คิวเดิมว่างแล้ว สามารถอนุมัติได้ทันที</p>}
      {blockers.map((item) => <Field key={item.id} label={item.booker_name + ' · ' + timeRange(item)}>
        <select required value={selected[item.id] ?? ''} disabled={busy}
          onChange={(event) => setSelected({ ...selected, [item.id]: event.target.value })}>
          <option value="">{item.rooms.length ? 'เลือกห้องปลายทางที่ว่าง' : 'ไม่มีห้องปลายทางที่ว่าง'}</option>
          {item.rooms.map((room) => <option value={room.id} key={room.id}>{room.name} ({room.capacity} คน)</option>)}
        </select>
      </Field>)}
      <div className="actions mt-2">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>กลับ</button>
        <button className="btn primary" disabled={busy || !blockers.every((item) => selected[item.id])}>
          <Shuffle size={17} /> {blockers.length ? 'ย้ายคิวเดิมและอนุมัติ' : 'อนุมัติคำขอ'}
        </button>
      </div>
    </form>}
  </Modal>;
}
