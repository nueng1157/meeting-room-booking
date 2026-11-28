import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const schema = async (file) => readFile(new URL('../supabase/' + file, import.meta.url), 'utf8');

test('กฎการจองและสิทธิ์บน PostgreSQL', async (t) => {
  const db = await PGlite.create({ extensions: { btree_gist } });
  t.after(() => db.close());
  const admin = randomUUID();
  const user = randomUUID();
  const vip = randomUUID();
  const newAccount = randomUUID();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to authenticated;
  `);
  for (const name of ['01-schema.sql', '02-booking-functions.sql', '03-seed-rooms.sql', '03-seed-rooms.sql']) {
    await db.exec(await schema(name));
  }
  await db.query('insert into auth.users(id) values ($1),($2),($3)', [admin, user, vip]);
  await db.query("update public.users set role = 'admin' where id = $1", [admin]);
  await db.query("update public.users set role = 'vip_edu' where id = $1", [vip]);
  const get = async (sql, parameters = []) => (await db.query(sql, parameters)).rows;
  const [first, second, third] = await get('select id from public.rooms order by capacity desc, name limit 3');
  assert.equal((await get('select count(*)::int as n from public.rooms'))[0].n, 9);
  async function auth(id) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  }
  const rpc = async (name, placeholders, values) => (
    await get('select public.' + name + '(' + placeholders + ') as result', values)
  )[0].result;
  const week = ['2099-01-05', '2099-01-12', '2099-01-19'];
  const payload = {
    room_id: first.id, start_time: '09:00', end_time: '10:00', booker_name: 'ผู้ทดสอบ',
    email: 'user@example.test', phone: '021234567', actual_user: 'ผู้ใช้งานตัวอย่าง',
    purpose: 'ประชุม', catering: ['กาแฟ'],
  };
  const preview = (booking, dates) => rpc('preview_booking', '$1,$2', [booking, dates]);
  const submit = (booking, dates, weekly, slots, id = randomUUID()) =>
    rpc('submit_booking', '$1,$2,$3,$4,$5', [booking, dates, weekly, JSON.stringify(slots), id]);
  const history = (isAdmin = false) => rpc('booking_history', '$1,$2,$3', [0, isAdmin, 'all']);
  const action = (kind, id, group = false) => rpc('admin_action', '$1,$2,$3', [kind, id, group]);

  await t.test('ผู้ใช้ทั่วไปสร้างคำขอ รันซ้ำอย่างปลอดภัย และเขียนตารางตรงไม่ได้', async () => {
    await auth(user);
    const empty = await preview(payload, [week[0]]);
    const requestId = randomUUID();
    assert.equal(empty[0].state, 'available');
    assert.equal((await submit(payload, [week[0]], false, empty, requestId)).created, 1);
    assert.equal((await submit(payload, [week[0]], false, empty, requestId)).replayed, true);
    assert.equal((await preview(payload, [week[0]]))[0].state, 'blocked');
    assert.equal((await preview({ ...payload, start_time: '10:00', end_time: '11:00' }, [week[0]]))[0].state, 'available');
    const stale = await submit(payload, [week[0]], false, empty);
    assert.equal(stale.changed, true);
    assert.equal(stale.slots[0].state, 'blocked');
    await assert.rejects(db.exec("update public.users set role = 'admin'"), /permission denied/);
    await assert.rejects(history(true), /ไม่มีสิทธิ์/);
    await assert.rejects(db.exec('select public.lock_booking_schedule()'), /permission denied/);
  });

  let regularGroup;
  let vipGroup;
  let vipRequest;
  await t.test('ข้ามวันที่ชนสำหรับผู้ใช้ทั่วไป และบันทึกคำขอแทรกคิวพร้อมรหัสชุด', async () => {
    const regularSlots = await preview(payload, week);
    assert.deepEqual(regularSlots.map((slot) => slot.state), ['blocked', 'available', 'available']);
    assert.equal((await submit(payload, week, true, regularSlots)).created, 2);
    const own = await history();
    regularGroup = own.find((booking) => booking.recurring_group_id).recurring_group_id;
    assert.equal(own.filter((record) => record.recurring_group_id === regularGroup).length, 2);
    await auth(vip);
    const vipDates = ['2098-12-29', ...week];
    const vipSlots = await preview(payload, vipDates);
    assert.deepEqual(vipSlots.map((slot) => slot.state), ['available', 'override', 'override', 'override']);
    assert.deepEqual(await submit(payload, vipDates, true, vipSlots), { created: 4, conflicts: 3 });
    assert.equal((await preview(payload, [week[0]]))[0].state, 'blocked');
    const vipBookings = await history();
    vipRequest = vipBookings.find((booking) => booking.booking_date === week[0]);
    vipGroup = vipRequest.recurring_group_id;
    assert.equal(vipRequest.status, 'conflict_pending');
    assert.equal((await get('select count(*)::int as n from public.bookings'))[0].n, 4);
    const calendar = await rpc('booking_overview', '$1,$2', [week[0], week[2]]);
    assert.equal(calendar.slots.length, 6);
    assert.ok(calendar.slots.every((slot) => !Object.hasOwn(slot, 'email') && !Object.hasOwn(slot, 'booker_name')));
  });

  await t.test('อนุมัติทั้งชุดหยุดเมื่อยังมีคิวชน และย้ายคิวเดิมกับอนุมัติ VIP ในรายการเดียว', async () => {
    await auth(admin);
    await assert.rejects(action('approve', vipGroup, true), /ยังมีคิว/);
    const all = await history(true);
    assert.equal(all.find((booking) => booking.booking_date === '2098-12-29').status, 'pending');
    assert.equal(await action('approve', regularGroup, true), 2);
    const details = await rpc('admin_conflict_details', '$1', [vipRequest.id]);
    assert.equal(details.blockers.length, 1);
    assert.ok(details.blockers[0].rooms.some((room) => room.id === second.id));
    const moves = [{ id: details.blockers[0].id, updated_at: details.blockers[0].updated_at, room_id: second.id }];
    await rpc('admin_resolve_conflict', '$1,$2,$3', [vipRequest.id, details.version, JSON.stringify(moves)]);
    const updated = await history(true);
    assert.equal(updated.find((booking) => booking.id === moves[0].id).room_id, second.id);
    assert.equal(updated.find((booking) => booking.id === vipRequest.id).status, 'approved');
    assert.equal(await action('cancel', vipGroup, true), 4);
  });

  await t.test('ปิดห้องและตรวจคิวใหม่เมื่อแก้ไขวันหรือห้อง', async () => {
    const entry = (await history(true)).find((booking) =>
      booking.booking_date === week[0] && booking.room_id === second.id);
    await rpc('admin_room_set_active', '$1,$2', [third.id, false]);
    await assert.rejects(preview({ ...payload, room_id: third.id }, [week[0]]), /ไม่เปิดให้จอง/);
    await assert.rejects(rpc('admin_edit_booking', '$1,$2,$3',
      [entry.id, entry.updated_at, { ...entry, room_id: third.id }]), /เปิดใช้งาน/);
    await rpc('admin_edit_booking', '$1,$2,$3', [entry.id, entry.updated_at, { ...entry, phone: '029999999' }]);
    assert.equal((await history(true)).find((booking) => booking.id === entry.id).phone, '029999999');
    await auth(user);
    assert.equal((await get('select id from public.rooms where id = $1', [third.id])).length, 0);
    await db.exec('reset role');
    await db.exec('set role anon');
    await assert.rejects(db.exec('select * from public.rooms'), /permission denied/);
  });

  await t.test('Auth สร้างโปรไฟล์ตามสิทธิ์ที่ Admin ตั้งและป้องกันการลดสิทธิ์ Admin คนสุดท้าย', async () => {
    await db.exec('reset role');
    const managed = (role, actor = admin) => ({
      meeting_booking_profile: { role, actor, full_name: 'บัญชีทดสอบ', department: 'การศึกษา' },
    });
    await db.query('insert into auth.users(id,raw_app_meta_data) values ($1,$2)', [newAccount, managed('vip_edu')]);
    assert.equal((await get('select role from public.users where id = $1', [newAccount]))[0].role, 'vip_edu');
    await assert.rejects(db.query('update auth.users set raw_app_meta_data = $2 where id = $1',
      [admin, managed('user')]), /ผู้ดูแลอย่างน้อยหนึ่ง/);
    await assert.rejects(db.query('update auth.users set raw_app_meta_data = $2 where id = $1',
      [newAccount, managed('admin', user)]), /ไม่มีสิทธิ์/);
  });
  await t.test('อัปเกรดจอทีวี แสดงเฉพาะคิวอนุมัติและหัวข้อที่ตั้งให้เปิดเผย', async () => {
    await db.exec(await schema('05-tv-display.sql'));
    const day = (await get("select ((now() at time zone 'Asia/Bangkok')::date)::text as day"))[0].day;
    const tvSchedule = (from = day, to = day) => rpc('admin_tv_schedule', '$1,$2', [from, to]);
    await auth(user);
    const approvedPayload = { ...payload, display_title: '  เตรียมการอบรม  ' };
    const request = randomUUID();
    const check = await preview(approvedPayload, [day]);
    assert.equal((await submit(approvedPayload, [day], false, check, request)).created, 1);
    assert.equal((await submit({ ...approvedPayload, display_title: 'หัวข้อของการส่งซ้ำ' },
      [day], false, check, request)).replayed, true);
    const privateText = { ...payload, start_time: '10:00', end_time: '11:00',
      purpose: 'อื่นๆ', purpose_other: 'รายละเอียดที่ใช้ภายใน' };
    await submit(privateText, [day], false, await preview(privateText, [day]));
    const pending = { ...payload, start_time: '11:00', end_time: '12:00', display_title: 'ยังรออนุมัติ' };
    await submit(pending, [day], false, await preview(pending, [day]));
    await assert.rejects(tvSchedule(), /ไม่มีสิทธิ์/);
    await assert.rejects(rpc('submit_booking_core', '$1,$2,$3,$4,$5',
      [approvedPayload, [day], false, JSON.stringify(check), request]), /permission denied/);

    await auth(admin);
    const requests = (await history(true)).filter((item) => item.booking_date === day);
    const entry = requests.find((item) => item.request_id === request);
    assert.equal(entry.display_title, 'เตรียมการอบรม');
    await action('approve', entry.id);
    await action('approve', requests.find((item) => item.purpose === 'อื่นๆ').id);
    const tv = await tvSchedule();
    assert.deepEqual(tv.counts, { [day]: 2 });
    assert.deepEqual(tv.today.map((item) => item.title), ['เตรียมการอบรม', 'อื่นๆ']);
    assert.deepEqual(tv.selected_day, tv.today);
    assert.ok(tv.today.every((item) => !Object.hasOwn(item, 'email') && !Object.hasOwn(item, 'purpose_other')));
    const distant = await tvSchedule('2099-01-01', '2099-01-31');
    assert.deepEqual(distant.today, tv.today);
    assert.deepEqual(distant.selected_day, []);

    const approved = (await history(true)).find((item) => item.id === entry.id);
    const { display_title, ...oldForm } = approved;
    await rpc('admin_edit_booking', '$1,$2,$3', [approved.id, approved.updated_at, oldForm]);
    assert.equal((await tvSchedule()).today[0].title, display_title);
    const refreshed = (await history(true)).find((item) => item.id === entry.id);
    await rpc('admin_edit_booking', '$1,$2,$3',
      [refreshed.id, refreshed.updated_at, { ...refreshed, display_title: 'ประชุมเตรียมการอบรม' }]);
    assert.equal((await tvSchedule()).today[0].title, 'ประชุมเตรียมการอบรม');
    await action('cancel', refreshed.id);
    assert.deepEqual((await tvSchedule()).counts, { [day]: 1 });
  });
  await t.test('กติกาเวลาจองมีผลกับทุกสิทธิ์ และแจ้งเตือนครั้งเดียวต่อคำขอ', async () => {
    await db.exec('reset role');
    const [{ id: locked }] = await get("select id from public.rooms where name = 'ห้องบรรยาย 3/1-2'");
    await db.query("update public.rooms set is_active = true where id = $1", [locked]);
    const dates = ['2099-02-02','2099-02-09'];
    await auth(user);
    const oldForm = { ...payload, room_id: locked, start_time: '08:00', end_time: '09:00' };
    await submit(oldForm, [dates[0]], false, await preview(oldForm, [dates[0]]));
    await auth(admin);
    const old = (await history(true)).find((item) => item.room_id === locked && item.booking_date === dates[0]);
    await action('approve', old.id);

    await db.exec('reset role');
    await db.exec(await schema('06-booking-time-rules.sql'));
    await auth(admin);
    const exceptions = await rpc('admin_booking_time_exceptions', '$1', [0]);
    assert.equal(exceptions.items[0].id, old.id);
    const info = await rpc('booking_time_rules', '', []);
    assert.equal(info.opens_at, '08:00:00');
    assert.equal(info.closes_at, '16:30:00');
    assert.equal(info.locks.filter((item) => item.enabled).length, 2);
    const summary = () => rpc('admin_queue_summary', '', []);
    assert.equal((await summary()).requests_total, 0);
    await assert.rejects(rpc('admin_edit_booking', '$1,$2,$3', [old.id, (await history(true)).find((item) => item.id === old.id).updated_at, {
      ...old, booking_date: dates[1],
    }]), /การจองอยู่แล้ว|ล็อก/);
    assert.equal((await history(true)).find((item) => item.id === old.id).status, 'approved');
    await auth(vip);
    await assert.rejects(preview({ ...oldForm, start_time: '08:30', end_time: '09:30' }, dates), /ล็อกทุกวัน/);
    const outside = { ...oldForm, start_time: '16:00', end_time: '17:00' };
    await assert.rejects(preview(outside, dates), /08:00–16:30/);
    await assert.rejects(submit(outside, dates, true, dates.map((date) => ({ date, state: 'available' }))), /08:00–16:30/);
    await assert.rejects(rpc('admin_save_booking_hours', '$1,$2', ['08:00','17:00']), /ไม่มีสิทธิ์/);
    const allowed = { ...oldForm, start_time: '15:30', end_time: '16:30' };
    assert.equal((await preview({ ...oldForm, start_time: '09:00', end_time: '10:00' }, dates))[0].state, 'available');
    const requestId = randomUUID();
    const slots = await preview(allowed, dates);
    assert.equal((await submit(allowed, dates, true, slots, requestId)).created, 2);
    assert.equal((await submit(allowed, dates, true, slots, requestId)).replayed, true);
    await auth(admin);
    assert.equal((await summary()).requests_total, 1);
    await rpc('admin_save_room_lock', '$1,$2,$3,$4', [locked,'08:00','09:00',false]);
    await rpc('admin_save_booking_hours', '$1,$2', ['08:00','17:00']);
    await db.exec('reset role');
    await db.exec(await schema('06-booking-time-rules.sql'));
    await auth(user);
    assert.equal((await preview({ ...oldForm, end_time: '08:30' }, [dates[1]]))[0].state, 'available');
    assert.equal((await preview(outside, [dates[1]]))[0].state, 'blocked');
  });
});
