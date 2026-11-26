export const roles = {
  admin: 'ผู้ดูแลระบบ', vip_edu: 'หน่วยการศึกษา (จองแทรกคิว)', user: 'ผู้ใช้งานทั่วไป',
};
export const statuses = {
  pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', conflict_pending: 'รอพิจารณาสลับห้อง', cancelled: 'ยกเลิกแล้ว',
};
export const purposes = ['ประชุม', 'อบรม', 'สอน', 'ปฐมนิเทศนักเรียน', 'Open House', 'สัมมนา', 'อื่นๆ'];
export const catering = ['อาหารว่าง', 'อาหารกลางวัน', 'กาแฟ'];
export const weekdays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const bangkok = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});
const thai = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
});
const fullThai = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
});
export const dateObject = (value) => new Date(value + 'T00:00:00Z');
const dateKey = (date) => date.toISOString().slice(0, 10);
export function today() {
  const parts = Object.fromEntries(bangkok.formatToParts().map(({ type, value }) => [type, value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
export const formatDate = (value, full = false) => (full ? fullThai : thai).format(dateObject(value));
export const timeText = (value) => value?.slice(0, 5);
export const timeRange = (booking) => timeText(booking.start_time) + '–' + timeText(booking.end_time) + ' น.';
export function addDays(value, count) {
  const date = dateObject(value);
  date.setUTCDate(date.getUTCDate() + count);
  return dateKey(date);
}
export function addMonths(value, count) {
  const date = dateObject(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + count);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return dateKey(date);
}
export function periodBounds(anchor, period) {
  if (period === 'day') return [anchor, anchor];
  if (period === 'week') {
    const start = addDays(anchor, -((dateObject(anchor).getUTCDay() + 6) % 7));
    return [start, addDays(start, 6)];
  }
  const start = anchor.slice(0, 7) + '-01';
  return [start, addDays(addMonths(start, 1), -1)];
}
export function bookingDates(start, weekly, day, end) {
  if (!start || !Number.isFinite(+dateObject(start))) throw new Error('กรุณาระบุวันที่จอง');
  if (!weekly) return [start];
  if (!end || !Number.isFinite(+dateObject(end)) || end < start) {
    throw new Error('กรุณาระบุวันที่สิ้นสุดตั้งแต่วันที่เริ่มต้น');
  }
  const first = addDays(start, (Number(day) - dateObject(start).getUTCDay() + 7) % 7);
  const dates = [];
  for (let date = first; date <= end; date = addDays(date, 7)) {
    dates.push(date);
  }
  if (!dates.length) throw new Error('ไม่มีวันในสัปดาห์ที่เลือกภายในช่วงวันที่นี้');
  return dates;
}

export function summarize(rooms, slots) {
  const counts = new Map(rooms.filter((room) => room.is_active).map((room) => [room.id, 0]));
  const byPurpose = new Map();
  for (const slot of slots) {
    counts.set(slot.room_id, (counts.get(slot.room_id) ?? 0) + 1);
    byPurpose.set(slot.purpose, (byPurpose.get(slot.purpose) ?? 0) + 1);
  }
  const roomStats = rooms.filter((room) => counts.has(room.id)).map((room) => ({
    name: room.name, count: counts.get(room.id),
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'));
  const extreme = (count) => roomStats.filter((room) => room.count === count);
  return {
    total: slots.length,
    most: slots.length ? extreme(roomStats[0]?.count) : [],
    least: slots.length ? extreme(roomStats.at(-1)?.count) : [],
    byPurpose: purposes.filter((name) => byPurpose.has(name)).map((name) => ({ name, count: byPurpose.get(name) })),
    roomStats,
  };
}
