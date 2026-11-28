import { useState } from 'react';
import { Clock3, LockKeyhole } from 'lucide-react';
import { explain, rpc } from './api';
import { Field, Loading, Message, PageTitle, Pager, useLoad } from './common';
import { formatDate, timeRange, timeText } from './domain';

export function useBookingRules() {
  return useLoad('booking-time-rules', () => rpc('booking_time_rules', {}));
}

const displayRange = (start, end) => timeText(start) + '–' + timeText(end) + ' น.';
export const bookingHoursText = (rules) => displayRange(rules.opens_at, rules.closes_at);
export const roomLockText = (rule) => displayRange(rule.starts_at, rule.ends_at);

export function BookingRules({ rooms }) {
  const rules = useBookingRules();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const exceptions = useLoad(revision + '/' + page, () => rpc('admin_booking_time_exceptions', { p_offset: page * 20 }));
  const refresh = () => { setPage(0); setRevision((n) => n + 1); };
  const [roomId, setRoomId] = useState('');
  const [savedLocks, setSavedLocks] = useState({});
  const room = rooms.find((entry) => entry.id === roomId);
  const locks = rules.data?.locks ?? [];
  const roomLock = savedLocks[roomId] ?? locks.find((entry) => entry.room_id === roomId);

  return <>
    <PageTitle title="ตั้งค่าเวลาจอง" subtitle="กำหนดเวลาจองทุกวันและช่วงล็อกของแต่ละห้อง ตามเวลาไทย" />
    {rules.loading && <Loading />}
    <Message>{rules.error}</Message>
    {rules.data && <div className="booking-layout">
      <div className="space-y-4">
        <section className="panel">
          <div className="section-heading"><h2>เวลาจองทุกห้อง</h2><Clock3 size={20} /></div>
          <TimeRuleForm start={rules.data.opens_at} end={rules.data.closes_at}
            save={(p_start, p_end) => rpc('admin_save_booking_hours', { p_start, p_end })}
            onSaved={refresh} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>ล็อกช่วงเวลารายห้อง</h2><LockKeyhole size={20} /></div>
          <Field label="เลือกห้อง">
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              <option value="">เลือกห้องประชุม</option>
              {rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          {room && <div className="mt-4">
            <TimeRuleForm key={room.id} start={roomLock?.starts_at ?? '08:00'} end={roomLock?.ends_at ?? '09:00'}
              active={roomLock?.enabled ?? false}
              save={async (p_start, p_end, p_enabled) => {
                await rpc('admin_save_room_lock', { p_room: room.id, p_start, p_end, p_enabled });
                const saved = { room_id: room.id, starts_at: p_start, ends_at: p_end, enabled: p_enabled };
                setSavedLocks((current) => ({ ...current, [room.id]: saved }));
              }}
              onSaved={refresh} />
          </div>}
        </section>
      </div>
      <section className="panel">
        <div className="section-heading"><h2>คิวเดิมที่อยู่นอกกติกา</h2></div>
        <p className="muted">ตรวจรายการตั้งแต่วันนี้ หากต้องการย้ายห้อง เปลี่ยนเวลา หรือยกเลิก ให้เปิดเมนูจัดการคิว</p>
        {exceptions.loading && <Loading />}
        <Message>{exceptions.error}</Message>
        {exceptions.data && <div className="mt-3">
          <p><strong>{exceptions.data.count.toLocaleString('th-TH')} รายการ</strong></p>
          <div className="agenda">{exceptions.data.items.map((item) => <article key={item.id}>
            <strong>{item.room_name}</strong>
            <p>{formatDate(item.booking_date)} · {timeRange(item)}</p>
            <small className="muted">{item.reason}</small>
          </article>)}</div>
          {(page > 0 || exceptions.data.count > 20) &&
            <Pager page={page} hasNext={exceptions.data.count > (page + 1) * 20}
              onChange={setPage} busy={exceptions.loading} />}
        </div>}
      </section>
    </div>}
  </>;
}

function TimeRuleForm({ start, end, active, save, onSaved }) {
  const [from, setFrom] = useState(timeText(start));
  const [to, setTo] = useState(timeText(end));
  const [enabled, setEnabled] = useState(active);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (from >= to) return setResult({ error: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม' });
    setBusy(true);
    setResult(null);
    try {
      await save(from, to, enabled);
      setResult({ success: 'บันทึกกติกาแล้ว' });
      onSaved();
    } catch (error) { setResult({ error: explain(error) }); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit}>
    <fieldset className="form-grid" disabled={busy}>
      {active !== undefined && <label className="switch sm:col-span-2">
        <input type="checkbox" role="switch" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span aria-hidden="true" />เปิดช่วงล็อกทุกวัน
      </label>}
      <Field label={active === undefined ? 'เริ่มจองได้ตั้งแต่' : 'เริ่มล็อก'}>
        <input type="time" required value={from} onChange={(event) => setFrom(event.target.value)} />
      </Field>
      <Field label={active === undefined ? 'จองได้ถึง' : 'สิ้นสุดการล็อก'}>
        <input type="time" required value={to} onChange={(event) => setTo(event.target.value)} />
      </Field>
    </fieldset>
    <Message>{result?.error}</Message>
    <Message type="success">{result?.success}</Message>
    <div className="actions mt-4"><button className="btn primary" disabled={busy}>
      {busy ? 'กำลังบันทึก…' : 'บันทึก'}
    </button></div>
  </form>;
}
