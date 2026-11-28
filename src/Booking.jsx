import { useState } from 'react';
import { ArrowLeft, Building2, CalendarCheck, CalendarPlus, Clock3, UsersRound } from 'lucide-react';
import { bookingDates, catering, dateObject, formatDate, addMonths, purposes, today, weekdays, timeText } from './domain';
import { explain, rpc } from './api';
import { Field, Message, PageTitle } from './common';
import { bookingHoursText, roomLockText, useBookingRules } from './BookingRules';

function initial(profile, email, booking, edit, prefill) {
  return {
    room_id: booking?.room_id ?? prefill?.room_id ?? '',
    booking_date: edit ? booking.booking_date : booking ? '' : prefill?.date ?? today(),
    start_time: timeText(booking?.start_time) ?? '09:00',
    end_time: timeText(booking?.end_time) ?? '10:00',
    booker_name: booking?.booker_name ?? profile?.full_name ?? '',
    email: booking?.email ?? email ?? '',
    phone: booking?.phone ?? '',
    actual_user: booking?.actual_user ?? '',
    purpose: booking?.purpose ?? 'ประชุม',
    purpose_other: booking?.purpose_other ?? '',
    display_title: booking?.display_title ?? '',
    catering: booking?.catering ?? [],
  };
}

export function BookingFields({ value, set, rooms, edit = false }) {
  const room = rooms.find((item) => item.id === value.room_id);
  const update = (event) => set({ ...value, [event.target.name]: event.target.value });
  const textField = (label, name, options = {}) => <Field label={label}>
    <input name={name} value={value[name]} onChange={update} required maxLength={180} {...options} />
  </Field>;
  return <>
    <Field label="ห้องประชุม" wide>
      <select name="room_id" value={value.room_id} onChange={update} required>
        <option value="">เลือกห้องประชุม</option>
        {rooms.filter((item) => item.is_active || (edit && item.id === value.room_id)).map((item) =>
          <option key={item.id} value={item.id}>{item.name}{!item.is_active && ' (ปิดใช้งาน)'}</option>)}
      </select>
    </Field>
    {room && <div className="room-info sm:col-span-2">
      <Building2 size={22} />
      <div><strong>{room.name}</strong>
        <p className="capacity"><UsersRound size={16} /> ความจุ {room.capacity} คน</p>
        <div className="chips">{room.equipment.length ? room.equipment.map((item) =>
          <span key={item}>{item}</span>) : <span>ไม่มีรายการอุปกรณ์</span>}</div>
      </div>
    </div>}
    <Field label={edit ? 'วันที่จอง' : 'วันที่จอง / วันที่เริ่มต้น'} wide>
      <input type="date" name="booking_date" value={value.booking_date} onChange={update}
        min={edit ? undefined : today()} max="9999-12-31" required />
    </Field>
    {textField('เวลาเริ่ม', 'start_time', { type: 'time' })}
    {textField('เวลาสิ้นสุด', 'end_time', { type: 'time' })}
    {textField('ชื่อ–สกุลผู้จอง', 'booker_name', { autoComplete: 'name' })}
    {textField('ชื่อผู้ใช้งานจริง', 'actual_user', { placeholder: 'เช่น ชื่ออาจารย์แพทย์ที่ใช้ห้อง' })}
    {textField('อีเมล', 'email', { type: 'email', maxLength: 254, autoComplete: 'email' })}
    {textField('เบอร์โทร', 'phone', { type: 'tel', maxLength: 40, autoComplete: 'tel' })}
    <Field label="วัตถุประสงค์" wide>
      <select name="purpose" value={value.purpose} onChange={update} required>
        {purposes.map((item) => <option key={item}>{item}</option>)}
      </select>
    </Field>
    {value.purpose === 'อื่นๆ' && <Field label="ระบุวัตถุประสงค์" wide>
      <textarea value={value.purpose_other} name="purpose_other" onChange={update} required maxLength={500} rows={2} />
    </Field>}
    <div className="sm:col-span-2">
      <Field label="ชื่อเรื่อง (หัวข้อสำหรับแสดงบนจอทีวี (ไม่บังคับ))">
        <input name="display_title" value={value.display_title} onChange={update} maxLength={140}
          placeholder="เช่น ประชุมทีมวางแผนการอบรม" aria-describedby="booking-tv-title-help" />
      </Field>
      <small id="booking-tv-title-help" className="muted">
        ผู้ที่เดินผ่านจอจะเห็นหัวข้อนี้หลังอนุมัติ หากเว้นว่าง จอจะแสดงเฉพาะประเภทกิจกรรม
      </small>
    </div>
    <fieldset className="checks sm:col-span-2">
      <legend>สวัสดิการ</legend>
      <div>{catering.map((item) => <label key={item}>
        <input type="checkbox" value={item} checked={value.catering.includes(item)} onChange={(event) => set({
          ...value, catering: event.target.checked ? [...value.catering, item] : value.catering.filter((x) => x !== item),
        })} /> {item}
      </label>)}</div>
    </fieldset>
  </>;
}

const slotLabels = {
  available: 'ห้องว่าง',
  blocked: 'ห้องไม่ว่าง (ระบบจะข้ามวันนี้)',
  override: 'ชนคิวเดิม (ส่งให้ผู้ดูแลสลับห้อง)',
};

export function Booking({ profile, email, rooms, duplicate, prefill, onComplete }) {
  const [value, setValue] = useState(() => initial(profile, email, duplicate, false, prefill));
  const [weekly, setWeekly] = useState(false);
  const [day, setDay] = useState(() => dateObject(value.booking_date || today()).getUTCDay());
  const [end, setEnd] = useState('');
  const [preset, setPreset] = useState('');
  const [slots, setSlots] = useState(null);
  const rules = useBookingRules();
  const lock = rules.data?.locks.find((item) => item.enabled && item.room_id === value.room_id);
  const [requestId, setRequestId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const selectedEnd = preset && value.booking_date ? addMonths(value.booking_date, Number(preset)) : end;
  const allowed = slots?.filter((item) => item.state !== 'blocked').length ?? 0;

  async function preview(event) {
    event.preventDefault();
    setError('');
    if (value.start_time >= value.end_time) return setError('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    setBusy(true);
    try {
      const dates = bookingDates(value.booking_date, weekly, day, selectedEnd);
      const data = await rpc('preview_booking', { p_booking: value, p_dates: dates });
      setSlots(data);
      setChanged(false);
      setRequestId(crypto.randomUUID());
    } catch (failure) { setError(explain(failure)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true);
    setError('');
    setChanged(false);
    try {
      const response = await rpc('submit_booking', {
        p_booking: value, p_dates: slots.map((slot) => slot.date), p_weekly: weekly,
        p_preview: slots, p_request_id: requestId,
      });
      if (response.changed) {
        setSlots(response.slots);
        setChanged(true);
      } else {
        const detail = response.conflicts ? ' ส่งให้ผู้ดูแลพิจารณาสลับห้อง ' + response.conflicts + ' รายการ' : '';
        onComplete('ส่งคำขอจองแล้ว ' + response.created + ' รายการ' + detail);
      }
    } catch (failure) { setError(explain(failure)); }
    finally { setBusy(false); }
  }

  return <>
    <PageTitle title={slots ? 'ตรวจสอบคิวก่อนยืนยัน' : duplicate ? 'คัดลอกการจอง' : 'จองห้องประชุม'}
      subtitle={slots ? 'ตรวจสอบผลของแต่ละวันที่ต้องการจอง' : 'เลือกห้องและระบุรายละเอียดเพื่อส่งคำขออนุมัติ'} />
    <div className="booking-layout">
      {slots ? <section className="panel">
        <Message type="warning">{changed && 'คิวมีการเปลี่ยนแปลง กรุณาตรวจสอบผลล่าสุดก่อนยืนยันอีกครั้ง'}</Message>
        <Message type="warning">{slots.some((slot) => slot.state === 'override') &&
          'ช่วงเวลานี้มีการจองอยู่แล้ว ระบบจะส่งคำขอให้ Admin พิจารณาสลับห้อง'}</Message>
        <div className="section-heading"><h2>{rooms.find((r) => r.id === value.room_id)?.name}</h2>
          <span className="muted">{value.start_time}–{value.end_time} น.</span></div>
        <ul className="slots">
          {slots.map((slot) => <li key={slot.date}>
            <span>{formatDate(slot.date, true)}</span><strong className={slot.state}>
              {!weekly && slot.state === 'blocked' ? 'ห้องไม่ว่าง (ส่งคำขอไม่ได้)' : slotLabels[slot.state]}
            </strong>
          </li>)}
        </ul>
        <Message>{error}</Message>
        <div className="actions mt-5">
          <button className="btn secondary" type="button" disabled={busy} onClick={() => { setSlots(null); setError(''); }}>
            <ArrowLeft size={17} /> กลับไปแก้ไข
          </button>
          <button className="btn primary" type="button" disabled={!allowed || busy} onClick={confirm}>
            <CalendarCheck size={18} /> {busy ? 'กำลังส่ง…' : 'ยืนยันจอง ' + allowed + ' รายการ'}
          </button>
        </div>
      </section> : <form className="panel" onSubmit={preview}>
        <div className="section-heading"><h2>รายละเอียดการจอง</h2><CalendarPlus size={20} /></div>
        <div className="form-grid">
          <Field label="รูปแบบการจอง" wide>
            <select value={weekly ? 'weekly' : 'single'} onChange={(event) => {
              setWeekly(event.target.value === 'weekly');
              setDay(dateObject(value.booking_date || today()).getUTCDay());
            }}>
              <option value="single">จองครั้งเดียว</option>
              <option value="weekly">จองซ้ำรายสัปดาห์</option>
            </select>
          </Field>
          {weekly && <>
            <Field label="วันในสัปดาห์"><select value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {weekdays.map((name, i) => <option value={i} key={name}>ทุกวัน{name}</option>)}
            </select></Field>
            <Field label="กำหนดระยะเวลา"><select value={preset} onChange={(event) => setPreset(event.target.value)}>
              <option value="">ระบุวันที่สิ้นสุด</option><option value="1">1 เดือน</option><option value="3">3 เดือน</option>
            </select></Field>
            <Field label="วันที่สิ้นสุด" wide><input type="date" min={value.booking_date || today()} max="9999-12-31"
              value={selectedEnd} required readOnly={Boolean(preset)} onChange={(e) => setEnd(e.target.value)} /></Field>
          </>}
          <BookingFields value={value} set={setValue} rooms={rooms} />
        </div>
        <Message>{error}</Message>
        <div className="actions mt-5"><button className="btn primary" disabled={busy}>
          <CalendarCheck size={18} /> {busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบคิว'}
        </button></div>
      </form>}
      <aside className="panel info-panel">
        <Clock3 size={22} /><h2>เวลาทำการจอง</h2>
        <p>{rules.data ? 'ทุกวัน ' + bookingHoursText(rules.data) : 'วันที่และเวลาที่แสดงในระบบอ้างอิงเวลาไทย'}</p>
        {lock && <Message type="warning">ห้องนี้ล็อกทุกวัน {roomLockText(lock)}</Message>}
        <hr /><h2>การอนุมัติ</h2><p>ดูผลและห้องล่าสุดได้ที่หน้าประวัติการจองหลังผู้ดูแลพิจารณาคำขอ</p>
      </aside>
    </div>
  </>;
}

export function EditBooking({ booking, rooms, onSave, onClose, busy, error }) {
  const [value, setValue] = useState(() => initial(null, null, booking, true, null));
  const [localError, setLocalError] = useState('');
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (value.start_time >= value.end_time) return setLocalError('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    setLocalError('');
    onSave(value);
  }}>
    <fieldset disabled={busy} className="form-grid">
      <BookingFields value={value} set={setValue} rooms={rooms} edit />
    </fieldset>
    <Message>{localError || error}</Message>
    <div className="actions mt-5">
      <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>กลับ</button>
      <button className="btn primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกรายละเอียด'}</button>
    </div>
  </form>;
}
