-- Run after 05-tv-display.sql. Safe to run again without resetting saved settings.
begin;

create table if not exists public.booking_hours (
  singleton boolean primary key default true check (singleton),
  opens_at time(0) not null,
  closes_at time(0) not null,
  check (opens_at < closes_at and closes_at < time '24:00')
);
insert into public.booking_hours values (true, '08:00', '16:30')
on conflict (singleton) do nothing;
alter table public.booking_hours enable row level security;
revoke all on public.booking_hours from public, anon, authenticated, service_role;

create table if not exists public.room_booking_locks (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  starts_at time(0) not null,
  ends_at time(0) not null,
  enabled boolean not null default true,
  check (starts_at < ends_at and ends_at < time '24:00')
);
insert into public.room_booking_locks(room_id, starts_at, ends_at)
select id, '08:00', '09:00' from public.rooms
where name in ('ห้องบรรยาย 3/1-2','ห้องบรรยาย 5/1-2')
or id in ('db5fe880-a43f-4292-b51b-05cfca000004','db5fe880-a43f-4292-b51b-05cfca000006')
on conflict (room_id) do nothing;
alter table public.room_booking_locks enable row level security;
revoke all on public.room_booking_locks from public, anon, authenticated, service_role;

create or replace function public.booking_time_rules()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_booking_role();
  return (select jsonb_build_object('opens_at',h.opens_at,'closes_at',h.closes_at,
    'locks',coalesce((select jsonb_agg(to_jsonb(l) order by l.room_id)
      from public.room_booking_locks l join public.rooms r on r.id = l.room_id
      where (r.is_active and l.enabled) or public.current_booking_role() = 'admin'), '[]'::jsonb))
    from public.booking_hours h where singleton);
end;
$$;

create or replace function public.admin_save_booking_hours(p_start time, p_end time)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lock_booking_schedule();
  perform public.require_booking_role(true);
  if p_start is null or p_end is null or p_start >= p_end or p_end >= time '24:00'
    or extract(second from p_start) <> 0 or extract(second from p_end) <> 0 then
    raise exception 'กรุณาตรวจเวลาเปิดและปิดรับจอง';
  end if;
  update public.booking_hours set opens_at = p_start, closes_at = p_end where singleton;
end;
$$;

create or replace function public.admin_save_room_lock(p_room uuid, p_start time, p_end time, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lock_booking_schedule();
  perform public.require_booking_role(true);
  if p_enabled is null or p_start is null or p_end is null or p_start >= p_end or p_end >= time '24:00'
    or extract(second from p_start) <> 0 or extract(second from p_end) <> 0 then
    raise exception 'กรุณาตรวจเวลาเริ่มและสิ้นสุดช่วงล็อก';
  end if;
  if not exists (select 1 from public.rooms where id = p_room) then raise exception 'ไม่พบห้องประชุม'; end if;
  insert into public.room_booking_locks values (p_room,p_start,p_end,p_enabled)
  on conflict (room_id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    enabled = excluded.enabled;
end;
$$;

create or replace function public.booking_time_problem(p_room uuid,p_start time,p_end time)
returns text language sql stable set search_path = '' as $$
  select case
    when p_start < h.opens_at or p_end > h.closes_at
      then 'จองได้เฉพาะเวลา ' || to_char(h.opens_at,'HH24:MI') || '–' || to_char(h.closes_at,'HH24:MI') || ' น.'
    when l.enabled and p_start < l.ends_at and l.starts_at < p_end
      then 'ห้องนี้ล็อกทุกวัน เวลา ' || to_char(l.starts_at,'HH24:MI') || '–' || to_char(l.ends_at,'HH24:MI') || ' น.'
  end
  from public.booking_hours h left join public.room_booking_locks l on l.room_id = p_room
  where h.singleton
$$;

-- Keep old approved bookings. Enforce new reservations, moves and approvals at the table.
create or replace function public.enforce_booking_time()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_problem text;
begin
  if new.status = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' and
    row(new.room_id,new.booking_date,new.start_time,new.end_time)
      is not distinct from row(old.room_id,old.booking_date,old.start_time,old.end_time)
    and (new.status = old.status or new.status = 'pending' and old.status = 'conflict_pending')
  then return new; end if;
  perform public.lock_booking_schedule();
  v_problem := public.booking_time_problem(new.room_id,new.start_time,new.end_time);
  if v_problem is not null then raise exception '%',v_problem; end if;
  return new;
end;
$$;

drop trigger if exists enforce_booking_time on public.bookings;
create trigger enforce_booking_time before insert or update on public.bookings
for each row execute function public.enforce_booking_time();

create or replace function public.booking_slot_state(
  p_room uuid, p_date date, p_start time, p_end time, p_role public.app_role, p_exclude uuid default null
) returns text language sql stable set search_path = '' as $$
  select case
    when public.booking_time_problem(p_room,p_start,p_end) is not null then 'blocked'
    when count(*) = 0 then 'available'
    when p_role = 'vip_edu' and bool_and(b.booker_role = 'user' and b.status in ('pending','approved'))
      then 'override'
    else 'blocked'
  end
  from public.bookings b where b.room_id = p_room and b.booking_date = p_date
    and b.start_time < p_end and p_start < b.end_time
    and b.status <> 'cancelled' and b.id is distinct from p_exclude
$$;

create or replace function public.admin_booking_time_exceptions(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_booking_role(true);
  return (with flagged as materialized (
    select b.id,r.name as room_name,b.booking_date,b.start_time,b.end_time,
      public.booking_time_problem(b.room_id,b.start_time,b.end_time) as reason
    from public.bookings b join public.rooms r on r.id=b.room_id
    where b.status <> 'cancelled' and b.booking_date >= (now() at time zone 'Asia/Bangkok')::date
  ), sample as (
    select * from flagged where reason is not null order by booking_date,start_time,id offset greatest(0,p_offset) limit 20
  )
  select jsonb_build_object('count',(select count(*) from flagged where reason is not null),
    'items',coalesce((select jsonb_agg(to_jsonb(sample) order by booking_date,start_time,id) from sample),'[]'::jsonb)));
end;
$$;

revoke all on function public.booking_time_rules(), public.admin_save_booking_hours(time,time),
  public.admin_save_room_lock(uuid,time,time,boolean), public.admin_booking_time_exceptions(integer),
  public.enforce_booking_time(), public.booking_time_problem(uuid,time,time)
from public, anon, authenticated, service_role;
grant execute on function public.booking_time_rules(), public.admin_save_booking_hours(time,time),
  public.admin_save_room_lock(uuid,time,time,boolean), public.admin_booking_time_exceptions(integer) to authenticated;

create or replace function public.preview_booking(p_booking jsonb, p_dates date[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := public.require_booking_role();
  v_room uuid := (p_booking->>'room_id')::uuid;
  v_start time := (p_booking->>'start_time')::time(0);
  v_end time := (p_booking->>'end_time')::time(0);
  v_result jsonb;
  v_problem text;
begin
  if not exists (select 1 from public.rooms where id = v_room and is_active) then
    raise exception 'ห้องนี้ไม่เปิดให้จอง';
  end if;
  if v_start is null or v_end is null or v_start >= v_end or v_end >= time '24:00' then
    raise exception 'กรุณาระบุเวลาเริ่มและเวลาสิ้นสุดให้ถูกต้อง';
  end if;
  if p_dates is null or cardinality(p_dates) < 1
    or exists (select 1 from unnest(p_dates) d where d is null or not isfinite(d)
      or d < (now() at time zone 'Asia/Bangkok')::date)
    or (select count(distinct d) from unnest(p_dates) d) <> cardinality(p_dates) then
    raise exception 'กรุณาระบุวันที่ตั้งแต่วันนี้ และไม่ซ้ำกัน';
  end if;
  v_problem := public.booking_time_problem(v_room,v_start,v_end);
  if v_problem is not null then raise exception '%',v_problem; end if;
  select jsonb_agg(jsonb_build_object(
    'date', d, 'state', public.booking_slot_state(v_room,d,v_start,v_end,v_role)
  ) order by d) into v_result from unnest(p_dates) d;
  return v_result;
end;
$$;

-- One event per request, including a weekly request. Seed no events from existing bookings.
create table if not exists public.booking_request_events (
  user_id uuid not null,
  request_id uuid not null,
  primary key (user_id, request_id)
);
alter table public.booking_request_events enable row level security;
revoke all on public.booking_request_events from public, anon, authenticated, service_role;

create or replace function public.record_booking_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('pending','conflict_pending') then
    insert into public.booking_request_events values (new.user_id,new.request_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.record_booking_request() from public, anon, authenticated, service_role;
drop trigger if exists record_booking_request on public.bookings;
create trigger record_booking_request after insert on public.bookings
for each row execute function public.record_booking_request();

create or replace function public.admin_queue_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_booking_role(true);
  return (select jsonb_build_object(
    'pending',count(*) filter (where status = 'pending'),
    'conflicts',count(*) filter (where status = 'conflict_pending'),
    'requests_total',(select count(*) from public.booking_request_events)
  ) from public.bookings where status in ('pending','conflict_pending'));
end;
$$;

notify pgrst, 'reload schema';
commit;
