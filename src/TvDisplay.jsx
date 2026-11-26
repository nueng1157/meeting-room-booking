import { useEffect, useState } from 'react';
import {
  ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3, Maximize2, Minimize2,
  Pause, Play, Tv,
} from 'lucide-react';
import { explain, rpc } from './api';
import { Empty, Loading, Message } from './common';
import { addDays, addMonths, dateObject, formatDate, periodBounds, timeRange, timeText, today } from './domain';
import './tv.css';
import departmentLogo from './assets/headped.png';

const thaiClock = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const thaiMonth = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'UTC', month: 'long', year: 'numeric',
});
const periodLabels = { day: 'รายวัน', week: 'รายสัปดาห์', month: 'รายเดือน' };
const dayLabels = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const statusLabels = { live: 'กำลังประชุม', upcoming: 'ยังไม่เริ่ม', ended: 'สิ้นสุดแล้ว' };

function useSchedule(from, to, currentDay) {
  const key = [from, to, currentDay].join('/');
  const [snapshot, setSnapshot] = useState({ key: '', data: null, error: '', updatedAt: null });

  useEffect(() => {
    let active = true;
    let fetching = false;
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const data = await rpc('admin_tv_schedule', { p_from: from, p_to: to });
        if (active) setSnapshot({ key, data, error: '', updatedAt: new Date() });
      } catch (failure) {
        if (active) setSnapshot((previous) => ({
          key,
          data: previous.key === key && !['42501', 'PGRST301', 'PGRST303'].includes(failure?.code)
            ? previous.data : null,
          updatedAt: previous.key === key ? previous.updatedAt : null,
          error: explain(failure),
        }));
      } finally {
        fetching = false;
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [from, to, currentDay, key]);

  return snapshot.key === key ? snapshot : { data: null, error: '', updatedAt: null };
}

function statusFor(item, currentDay, time) {
  if (item.booking_date < currentDay || (item.booking_date === currentDay && timeText(item.end_time) <= time)) {
    return 'ended';
  }
  if (item.booking_date === currentDay && timeText(item.start_time) <= time) return 'live';
  return 'upcoming';
}

export function TvDisplay({ onClose }) {
  const [period, setPeriod] = useState('month');
  const [selected, setSelected] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [screenError, setScreenError] = useState('');
  const currentDay = today();
  const anchor = selected ?? currentDay;
  const clock = thaiClock.format(now);
  const [from, to] = periodBounds(anchor, period);
  const { data, error, updatedAt } = useSchedule(from, to, currentDay);
  const todayItems = (data?.today ?? []).map((item) => ({
    ...item, status: statusFor(item, currentDay, clock),
  }));
  const liveCount = todayItems.filter((item) => item.status === 'live').length;
  const remaining = todayItems.filter((item) => item.status !== 'ended');
  const dailyItems = (data?.selected_day ?? []).map((item) => ({
    ...item, status: statusFor(item, currentDay, clock),
  }));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 5000);
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('fullscreenchange', sync);
    };
  }, []);

  async function toggleFullscreen() {
    setScreenError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setScreenError('เปิดเต็มจอไม่ได้ ลองใช้ปุ่ม F11 ในเบราว์เซอร์');
    }
  }

  function close() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onClose();
  }

  function move(direction) {
    if (period === 'month') setSelected(addMonths(anchor, direction));
    else setSelected(addDays(anchor, direction * (period === 'week' ? 7 : 1)));
  }

  function showDay(date) {
    setSelected(date === currentDay ? null : date);
    setPeriod('day');
  }

  const heading = period === 'month' ? thaiMonth.format(dateObject(anchor))
    : period === 'day' ? formatDate(anchor, true) : formatDate(from) + ' – ' + formatDate(to);

  return <main className="tv-display">
    <header className="tv-header">
      <div className="tv-brand">
        
        <img
  className="tv-department-logo"
  src={departmentLogo}
  alt="ภาควิชากุมารเวชศาสตร์ คณะแพทยศาสตร์ศิริราชพยาบาล มหาวิทยาลัยมหิดล"
  width={397}
  height={105}
/>
        <div><h1>ปฏิทินห้องประชุม</h1><p>จอแสดงกำหนดการ</p></div>
      </div>
      <div className="tv-clock"><Clock3 size={21} /><span>{formatDate(currentDay, true)}</span><strong>{clock} น.</strong></div>
      <div className="tv-header-actions">
        <button className="tv-button" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          {fullscreen ? 'ย่อจอ' : 'เต็มจอ'}
        </button>
        <button className="tv-button" onClick={close}><ArrowLeft size={18} /> กลับระบบ</button>
      </div>
    </header>

    <div className="tv-notices">
      <Message>{screenError}</Message>
      <Message type={data ? 'warning' : 'error'}>
        {error && (data ? 'อัปเดตข้อมูลไม่ได้ กำลังแสดงข้อมูลครั้งล่าสุด' : error)}
      </Message>
    </div>

    <div className="tv-layout">
      <section className="tv-panel" aria-label="ปฏิทินการจอง">
        <div className="tv-panel-top">
          <div className="tv-heading"><CalendarDays size={21} /><h2>{heading}</h2></div>
          <div className="tv-switch" aria-label="มุมมองปฏิทิน">
            {Object.entries(periodLabels).map(([value, text]) =>
              <button key={value} aria-pressed={value === period} onClick={() => setPeriod(value)}>{text}</button>)}
          </div>
        </div>
        <div className="tv-calendar-tools">
          <div className="tv-nav">
            <button className="tv-button" onClick={() => move(-1)} aria-label="ช่วงก่อนหน้า"><ChevronLeft size={18} /></button>
            <button className="tv-button" onClick={() => setSelected(null)}>วันนี้</button>
            <button className="tv-button" onClick={() => move(1)} aria-label="ช่วงถัดไป"><ChevronRight size={18} /></button>
          </div>
          {data && <span>อนุมัติแล้ว <strong>{Object.values(data.counts).reduce((sum, count) => sum + count, 0)}</strong> รายการ</span>}
        </div>
        {!data && !error && <Loading />}
        {data && (period === 'day'
          ? <TvAgenda key={anchor} items={dailyItems} empty="ไม่มีรายการจองที่อนุมัติในวันที่เลือก" />
          : <TvGrid from={from} to={to} period={period} counts={data.counts} currentDay={currentDay} onSelect={showDay} />)}
      </section>

      <aside className="tv-panel tv-side" aria-labelledby="tv-today">
        <div className="tv-panel-top">
          <div className="tv-heading"><Clock3 size={21} /><h2 id="tv-today">กำหนดการวันนี้</h2></div>
          {data && <span className="tv-live-count"><i />กำลังประชุม {liveCount.toLocaleString('th-TH')} รายการ</span>}
        </div>
        <p className="tv-today-date">{formatDate(currentDay, true)}</p>
        {!data && !error && <Loading />}
        {data && <TvAgenda key={currentDay} items={remaining}
          empty={todayItems.length ? 'การประชุมวันนี้สิ้นสุดแล้ว' : 'วันนี้ยังไม่มีการจองที่อนุมัติ'} />}
      </aside>
    </div>
    {updatedAt && <p className="tv-updated">ข้อมูลล่าสุด {thaiClock.format(updatedAt)} น.</p>}
  </main>;
}

function TvGrid({ from, to, period, counts, currentDay, onSelect }) {
  const start = period === 'month' ? periodBounds(from, 'week')[0] : from;
  const end = period === 'month' ? periodBounds(to, 'week')[1] : to;
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return <div className={'tv-grid ' + period}>
    {dayLabels.map((name) => <span key={name} className="tv-day-heading">{name}</span>)}
    {dates.map((date) => {
      const inRange = date >= from && date <= to;
      const count = counts[date] ?? 0;
      return <button key={date} className={'tv-day' + (inRange ? '' : ' outside')}
        aria-current={date === currentDay ? 'date' : undefined}
        aria-label={formatDate(date, true) + (inRange ? ' จอง ' + count + ' รายการ' : '')}
        onClick={() => onSelect(date)}>
        <strong>{dateObject(date).getUTCDate()}</strong>
        {inRange && <span className={count ? 'has-bookings' : 'zero-bookings'}>{count}<small> รายการ</small></span>}
      </button>;
    })}
  </div>;
}

function TvAgenda({ items, empty }) {
  const pageSize = 4;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const page = index % pages;

  useEffect(() => {
    if (paused || pages < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % pages), 15000);
    return () => window.clearInterval(timer);
  }, [pages, paused]);

  if (!items.length) return <Empty>{empty}</Empty>;
  return <>
    <ul className="tv-agenda">
      {items.slice(page * pageSize, (page + 1) * pageSize).map((item) => <li key={item.id}>
        <div className="tv-slot-heading">
          <span className="tv-time">{timeRange(item)}</span>
          <span className={'tv-slot-status ' + item.status}><i />{statusLabels[item.status]}</span>
        </div>
        <strong>{item.title}</strong>
        <span>{item.room_name}</span>
      </li>)}
    </ul>
    {pages > 1 && <div className="tv-pager">
      <button className="tv-button" onClick={() => setIndex((page + pages - 1) % pages)} aria-label="คิวหน้าก่อน"><ChevronLeft size={17} /></button>
      <span>หน้า {page + 1} / {pages}</span>
      <button className="tv-button" onClick={() => setIndex((page + 1) % pages)} aria-label="คิวหน้าถัดไป"><ChevronRight size={17} /></button>
      <button className="tv-button" aria-label={paused ? 'เริ่มเลื่อนอัตโนมัติ' : 'พักการเลื่อนอัตโนมัติ'}
        onClick={() => setPaused(!paused)}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>
    </div>}
  </>;
}
