import { lazy, Suspense, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Building2, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock3, LayoutGrid, ListFilter } from 'lucide-react';
import { rpc } from './api';
import { addDays, addMonths, dateObject, formatDate, periodBounds, summarize, timeRange, today, weekdays } from './domain';
import { Empty, Loading, Message, PageTitle, Status, useLoad } from './common';

const PurposeChart = lazy(() => import('./PurposeChart'));

function useOverview(anchor, period) {
  const [from, to] = periodBounds(anchor, period);
  const state = useLoad(from + '/' + to, () => rpc('booking_overview', { p_from: from, p_to: to }));
  return { from, to, ...state };
}

export function Dashboard({ onBook }) {
  const [period, setPeriod] = useState('month');
  const [anchor, setAnchor] = useState(today);
  const { data, loading, error, from, to } = useOverview(anchor, period);
  const analytics = data && summarize(data.rooms, data.slots);
  return <>
    <PageTitle title="ภาพรวมการจอง" subtitle="ติดตามการใช้ห้องประชุมและจำนวนคำขอในช่วงเวลาที่เลือก">
      <button className="btn primary" onClick={onBook}><CalendarPlus size={19} /> จองห้องประชุม</button>
    </PageTitle>
    <section className="range-panel" aria-label="ตัวกรองช่วงเวลา">
      <div className="range-label"><CalendarDays size={20} /><div>
        <strong>{formatDate(from)}{from !== to && ' – ' + formatDate(to)}</strong>
        <small>อ้างอิงเวลาไทย</small>
      </div></div>
      <div className="range-controls">
        <div className="segments" aria-label="ช่วงเวลา">{[
          ['day', 'รายวัน'], ['week', 'รายสัปดาห์'], ['month', 'รายเดือน'],
        ].map(([key, label]) => <button key={key} aria-pressed={key === period}
          onClick={() => setPeriod(key)}>{label}</button>)}</div>
        <input type="date" value={anchor} aria-label="วันที่อ้างอิง" onChange={(e) => e.target.value && setAnchor(e.target.value)} />
      </div>
    </section>
    {loading && <Loading />}
    <Message>{error}</Message>
    {analytics && <>
      <div className="kpi-grid">
        <Kpi icon={CalendarDays} title="การจองทั้งหมด" variant="blue" value={analytics.total.toLocaleString('th-TH')}
          detail="คำขอในช่วงเวลาที่เลือก" />
        <Kpi icon={ArrowUpRight} title="ห้องที่ใช้งานบ่อยที่สุด" variant="green"
          value={analytics.most[0]?.name ?? '—'} others={analytics.most.slice(1)}
          detail={analytics.most.length ? analytics.most[0].count + ' รายการ' : 'ยังไม่มีข้อมูล'} />
        <Kpi icon={ArrowDownRight} title="ห้องที่ใช้งานน้อยที่สุด" variant="purple"
          value={analytics.least[0]?.name ?? '—'} others={analytics.least.slice(1)}
          detail={analytics.least.length ? analytics.least[0].count + ' รายการ' : 'ยังไม่มีข้อมูล'} />
      </div>
      <div className="chart-grid">
        <section className="panel chart-panel">
          <div className="section-heading"><h2>การจองตามวัตถุประสงค์</h2><LayoutGrid size={20} /></div>
          {analytics.byPurpose.length ? <Suspense fallback={<Loading />}><PurposeChart items={analytics.byPurpose} /></Suspense> : <Empty>ยังไม่มีรายการจองในช่วงเวลานี้</Empty>}
        </section>
        <section className="panel chart-panel">
          <div className="section-heading"><h2>จำนวนการจองรายห้อง</h2><Building2 size={20} /></div>
          {analytics.roomStats.length ? <ul className="room-stats">{analytics.roomStats.map((item) =>
            <li key={item.name}><span>{item.name}</span><strong>{item.count.toLocaleString('th-TH')}</strong></li>)}</ul>
            : <Empty>ยังไม่มีห้องประชุมที่เปิดใช้งาน</Empty>}
        </section>
      </div>
    </>}
  </>;
}

function Kpi({ icon: Icon, title, variant, value, detail, others = [] }) {
  return <section className="panel kpi">
    <div className={'tile-icon ' + variant}><Icon size={21} /></div>
    <h2>{title}</h2><strong>{value}</strong><p>{detail}</p>
    {others.length > 0 && <details><summary>มีอีก {others.length} ห้องที่มีจำนวนเท่ากัน</summary>
      <ul>{others.map((item) => <li key={item.name}>{item.name}</li>)}</ul>
    </details>}
  </section>;
}

export function Calendar({ onBook }) {
  const [anchor, setAnchor] = useState(today);
  const [roomId, setRoom] = useState('');
  const { from, to, data, loading, error } = useOverview(anchor, 'month');
  const gridStart = periodBounds(from, 'week')[0];
  const gridEnd = periodBounds(to, 'week')[1];
  const days = [];
  for (let date = gridStart; date <= gridEnd; date = addDays(date, 1)) days.push(date);
  const booked = new Set(data?.slots.map((slot) => slot.room_id));
  const active = data?.rooms.filter((room) => room.is_active || booked.has(room.id)) ?? [];
  const selectedRoom = active.some((room) => room.id === roomId) ? roomId : '';
  const counts = new Map();
  for (const slot of data?.slots ?? []) {
    if (!selectedRoom || slot.room_id === selectedRoom) {
      counts.set(slot.booking_date, (counts.get(slot.booking_date) ?? 0) + 1);
    }
  }
  const filteredRooms = active.filter((room) => !selectedRoom || room.id === selectedRoom);
  const daily = data?.slots.filter((slot) => slot.booking_date === anchor) ?? [];

  return <>
    <PageTitle title="ปฏิทินห้องประชุม" subtitle="เลือกวันที่เพื่อดูช่วงเวลาที่มีการจองแยกตามห้อง" />
    <div className="calendar-layout">
      <section className="panel calendar-panel">
        <div className="section-heading calendar-heading">
          <h2>{new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(dateObject(anchor))}</h2>
          <div className="calendar-nav">
            <button className="icon-btn" onClick={() => setAnchor(addMonths(anchor, -1))} aria-label="เดือนก่อน"><ChevronLeft size={19} /></button>
            <button className="btn secondary" onClick={() => setAnchor(today())}>วันนี้</button>
            <button className="icon-btn" onClick={() => setAnchor(addMonths(anchor, 1))} aria-label="เดือนถัดไป"><ChevronRight size={19} /></button>
          </div>
        </div>
        <div className="month-grid">
          {[...weekdays.slice(1), weekdays[0]].map((day) => <span className="day-head" key={day}>
            {({ จันทร์: 'จ.', อังคาร: 'อ.', พุธ: 'พ.', พฤหัสบดี: 'พฤ.', ศุกร์: 'ศ.', เสาร์: 'ส.', อาทิตย์: 'อา.' })[day]}
          </span>)}
          {days.map((date) => <button key={date} type="button" aria-pressed={date === anchor}
            aria-current={date === today() ? 'date' : undefined}
            aria-label={formatDate(date, true) + (counts.has(date) ? ' มี ' + counts.get(date) + ' รายการ' : '')}
            className={date < from || date > to ? 'outside' : ''}
            onClick={() => setAnchor(date)}><span>{dateObject(date).getUTCDate()}</span>
            {counts.has(date) && <small>{counts.get(date)}<span className="max-sm:hidden"> รายการ</span></small>}
          </button>)}
        </div>
        <Message>{error}</Message>
      </section>
      <section className="panel">
        <div className="section-heading"><h2>{formatDate(anchor, true)}</h2><Clock3 size={20} /></div>
        {data && <label className="room-filter"><ListFilter size={17} />
          <select aria-label="กรองห้องประชุม" value={selectedRoom} onChange={(e) => setRoom(e.target.value)}>
            <option value="">ทุกห้องประชุม</option>{active.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
        </label>}
        {loading && <Loading />}
        {data && !filteredRooms.length && <Empty>ไม่มีห้องในช่วงที่เลือก</Empty>}
        <div className="agenda">
          {filteredRooms.map((room) => {
            const items = daily.filter((item) => item.room_id === room.id);
            return <article key={room.id}>
              <div className="agenda-room"><strong>{room.name}</strong>
                {room.is_active && anchor >= today() && <button className="text-btn" onClick={() => onBook({ date: anchor, room_id: room.id })}>
                  จองห้องนี้
                </button>}
              </div>
              {!room.is_active && <p className="muted">ปิดใช้งาน</p>}
              {room.is_active && !items.length && <p className="available">ห้องว่างตลอดวัน</p>}
              {items.map((item, i) => <div className="agenda-event" key={i}>
                <span>{timeRange(item)}</span><Status value={item.status} />
              </div>)}
            </article>;
          })}
        </div>
      </section>
    </div>
  </>;
}
