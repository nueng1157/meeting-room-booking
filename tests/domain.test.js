import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, bookingDates, periodBounds, summarize } from '../src/domain.js';

test('จัดช่วงสัปดาห์จันทร์ถึงอาทิตย์ และตัดวันสิ้นเดือนตามปฏิทิน', () => {
  assert.deepEqual(periodBounds('2028-02-06', 'week'), ['2028-01-31', '2028-02-06']);
  assert.deepEqual(periodBounds('2028-02-01', 'month'), ['2028-02-01', '2028-02-29']);
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
});

test('เริ่มจองจากวันในสัปดาห์ที่เลือกและรวมวันสิ้นสุด', () => {
  assert.deepEqual(bookingDates('2028-02-01', true, 1, '2028-02-21'), [
    '2028-02-07', '2028-02-14', '2028-02-21',
  ]);
  assert.throws(() => bookingDates('2028-02-01', true, 1, '2028-02-04'), /ไม่มีวัน/);
});

test('รวมห้องที่เปิดให้บริการแต่ยังไม่ถูกจองในสถิติการใช้งานน้อยที่สุด', () => {
  const rooms = [
    { id: 'a', name: 'ห้อง ก', is_active: true },
    { id: 'b', name: 'ห้อง ข', is_active: true },
    { id: 'c', name: 'ห้อง ค', is_active: false },
  ];
  const result = summarize(rooms, [{ room_id: 'a', purpose: 'อบรม' }]);
  assert.equal(result.total, 1);
  assert.deepEqual(result.least, [{ name: 'ห้อง ข', count: 0 }]);
  assert.deepEqual(result.byPurpose, [{ name: 'อบรม', count: 1 }]);
});
