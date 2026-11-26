begin;

create function public.require_booking_role(p_admin boolean default false)
returns public.app_role language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role := public.current_booking_role();
begin
  if v_role is null or (p_admin and v_role <> 'admin') then
    raise exception 'ไม่มีสิทธิ์ดำเนินการ' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Serialize scheduling writes. The exclusion constraint also protects the two occupying statuses.
create function public.lock_booking_schedule()
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(629341, 781)
$$;

create function public.booking_slot_state(
  p_room uuid, p_date date, p_start time, p_end time, p_role public.app_role, p_exclude uuid default null
) returns text language sql stable set search_path = '' as $$
  select case
    when count(*) = 0 then 'available'
    when p_role = 'vip_edu' and bool_and(b.booker_role = 'user' and b.status in ('pending','approved'))
      then 'override'
    else 'blocked'
  end
  from public.bookings b
  where b.room_id = p_room and b.booking_date = p_date
    and b.start_time < p_end and p_start < b.end_time
    and b.status <> 'cancelled' and b.id is distinct from p_exclude
$$;

create function public.preview_booking(p_booking jsonb, p_dates date[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := public.require_booking_role();
  v_room uuid := (p_booking->>'room_id')::uuid;
  v_start time := (p_booking->>'start_time')::time(0);
  v_end time := (p_booking->>'end_time')::time(0);
  v_result jsonb;
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
  select jsonb_agg(jsonb_build_object(
    'date', d, 'state', public.booking_slot_state(v_room,d,v_start,v_end,v_role)
  ) order by d) into v_result from unnest(p_dates) d;
  return v_result;
end;
$$;

create function public.submit_booking(
  p_booking jsonb, p_dates date[], p_weekly boolean, p_preview jsonb, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := public.require_booking_role();
  v_slots jsonb;
  v_slot jsonb;
  v_group uuid;
  v_count integer := 0;
  v_conflicts integer := 0;
  v_purpose public.booking_purpose := (p_booking->>'purpose')::public.booking_purpose;
begin
  perform public.lock_booking_schedule();
  v_role := public.require_booking_role();
  select count(*), count(*) filter (where created.status = 'conflict_pending')
    into v_count, v_conflicts
  from public.bookings created where created.user_id = auth.uid() and created.request_id = p_request_id;
  if v_count > 0 then
    return jsonb_build_object('created', v_count, 'conflicts', v_conflicts, 'replayed', true);
  end if;
  if p_request_id is null or p_weekly is null or (not p_weekly and cardinality(p_dates) <> 1) then
    raise exception 'รูปแบบการจองไม่ถูกต้อง';
  end if;
  if p_weekly and (select count(distinct extract(isodow from d)) from unnest(p_dates) d) <> 1 then
    raise exception 'รายการจองรายสัปดาห์ต้องเป็นวันเดียวกันของสัปดาห์';
  end if;
  v_slots := public.preview_booking(p_booking, p_dates);
  if v_slots is distinct from p_preview then
    return jsonb_build_object('changed', true, 'slots', v_slots);
  end if;
  if p_weekly then v_group := gen_random_uuid(); end if;
  for v_slot in select value from jsonb_array_elements(v_slots)
  loop
    if v_slot->>'state' = 'blocked' then continue; end if;
    insert into public.bookings (
      room_id,user_id,booker_role,booking_date,start_time,end_time,
      booker_name,email,phone,actual_user,purpose,purpose_other,catering,status,recurring_group_id,request_id
    ) values (
      (p_booking->>'room_id')::uuid,auth.uid(),v_role,(v_slot->>'date')::date,
      (p_booking->>'start_time')::time,(p_booking->>'end_time')::time,
      btrim(p_booking->>'booker_name'),lower(btrim(p_booking->>'email')),
      btrim(p_booking->>'phone'),btrim(p_booking->>'actual_user'),v_purpose,
      case when v_purpose = 'อื่นๆ' then btrim(p_booking->>'purpose_other') end,
      array(select distinct value from jsonb_array_elements_text(coalesce(p_booking->'catering','[]'))),
      case when v_slot->>'state' = 'override' then 'conflict_pending'::public.booking_status
        else 'pending'::public.booking_status end,
      v_group,p_request_id
    );
    v_count := v_count + 1;
    if v_slot->>'state' = 'override' then v_conflicts := v_conflicts + 1; end if;
  end loop;
  if v_count = 0 then raise exception 'ไม่มีวันที่สามารถส่งคำขอจองได้'; end if;
  return jsonb_build_object('created',v_count,'conflicts',v_conflicts);
end;
$$;

create function public.booking_history(p_offset integer default 0, p_admin boolean default false, p_filter text default 'all')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_data jsonb;
begin
  perform public.require_booking_role(p_admin);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc, q.id), '[]') into v_data
  from (
    select b.*, r.name as room_name,
      case when b.recurring_group_id is null then 0 else (
        select count(*) from public.bookings g where g.recurring_group_id = b.recurring_group_id
      ) end as group_count
    from public.bookings b join public.rooms r on r.id = b.room_id
    where (p_admin or b.user_id = auth.uid())
      and (p_filter = 'all' or p_filter = b.status::text
        or (p_filter = 'queue' and b.status in ('pending','conflict_pending')))
    order by b.created_at desc, b.id
    offset greatest(0,p_offset) limit 21
  ) q;
  return v_data;
end;
$$;

create function public.booking_overview(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.require_booking_role();
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to < p_from or p_to - p_from > 31 then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  select jsonb_build_object(
    'rooms', coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from
      (select id,name,is_active from public.rooms) r), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(to_jsonb(b) order by booking_date,start_time,room_id)
      from (select room_id,booking_date,start_time,end_time,status,purpose
        from public.bookings where booking_date between p_from and p_to and status <> 'cancelled') b), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create function public.admin_room_save(p_room jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid := (p_room->>'id')::uuid;
begin
  perform public.lock_booking_schedule();
  perform public.require_booking_role(true);
  if v_id is null then
    insert into public.rooms(name,capacity,equipment,is_active)
    values (btrim(p_room->>'name'),(p_room->>'capacity')::integer,
      array(select distinct btrim(value) from jsonb_array_elements_text(p_room->'equipment') where btrim(value) <> ''),
      (p_room->>'is_active')::boolean);
  else
    update public.rooms set name = btrim(p_room->>'name'), capacity = (p_room->>'capacity')::integer,
      equipment = array(select distinct btrim(value) from jsonb_array_elements_text(p_room->'equipment') where btrim(value) <> ''),
      is_active = (p_room->>'is_active')::boolean
    where id = v_id;
    if not found then raise exception 'ไม่พบห้องประชุม'; end if;
  end if;
end;
$$;

create function public.admin_action(p_action text, p_id uuid, p_group boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings%rowtype; v_count integer := 0;
begin
  perform public.lock_booking_schedule();
  perform public.require_booking_role(true);
  if p_action not in ('approve','cancel') or p_action is null then raise exception 'คำสั่งไม่ถูกต้อง'; end if;
  for v_booking in select * from public.bookings b
      where ((not p_group and b.id = p_id) or (p_group and b.recurring_group_id = p_id))
        and (case when p_action = 'approve' then b.status in ('pending','conflict_pending')
                  else b.status <> 'cancelled' end)
      order by b.booking_date,b.start_time,b.id
  loop
    if p_action = 'approve' and not exists (
      select 1 from public.rooms r where r.id = v_booking.room_id and r.is_active
    ) then raise exception 'มีรายการในห้องที่ปิดใช้งาน กรุณาย้ายห้องก่อนอนุมัติ'; end if;
    if p_action = 'approve' and v_booking.status = 'conflict_pending' and
      public.booking_slot_state(v_booking.room_id,v_booking.booking_date,v_booking.start_time,
        v_booking.end_time,'admin',v_booking.id) <> 'available'
    then raise exception 'ยังมีคิวที่ต้องสลับห้อง กรุณาจัดการคิวชนก่อนอนุมัติ'; end if;
    update public.bookings set status = case when p_action = 'approve' then 'approved'::public.booking_status
      else 'cancelled'::public.booking_status end, updated_at = clock_timestamp()
    where id = v_booking.id;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'ไม่มีรายการที่ดำเนินการได้'; end if;
  return v_count;
end;
$$;

create function public.admin_edit_booking(p_id uuid, p_version timestamptz, p_booking jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.bookings%rowtype;
  v_new public.booking_status;
  v_room uuid := (p_booking->>'room_id')::uuid;
  v_date date := (p_booking->>'booking_date')::date;
  v_start time := (p_booking->>'start_time')::time(0);
  v_end time := (p_booking->>'end_time')::time(0);
  v_purpose public.booking_purpose := (p_booking->>'purpose')::public.booking_purpose;
  v_state text;
begin
  perform public.lock_booking_schedule();
  perform public.require_booking_role(true);
  select * into v_old from public.bookings where id = p_id;
  if not found or v_old.updated_at is distinct from p_version then
    raise exception 'รายการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  v_new := v_old.status;
  if v_new <> 'cancelled' and (v_new = 'conflict_pending'
    or row(v_room,v_date,v_start,v_end) is distinct from
       row(v_old.room_id,v_old.booking_date,v_old.start_time,v_old.end_time)) then
    if not exists (select 1 from public.rooms where id = v_room and is_active) then
      raise exception 'กรุณาเลือกห้องที่เปิดใช้งาน';
    end if;
    v_state := public.booking_slot_state(v_room,v_date,v_start,v_end,
      case when v_new = 'conflict_pending' then 'vip_edu'::public.app_role else 'admin'::public.app_role end,p_id);
    if v_state = 'blocked' then raise exception 'ห้องและเวลาที่เลือกมีการจองอยู่แล้ว'; end if;
    if v_new = 'conflict_pending' and v_state = 'available' then v_new := 'pending'; end if;
  end if;
  update public.bookings set room_id = v_room, booking_date = v_date, start_time = v_start, end_time = v_end,
    booker_name = btrim(p_booking->>'booker_name'), email = lower(btrim(p_booking->>'email')),
    phone = btrim(p_booking->>'phone'), actual_user = btrim(p_booking->>'actual_user'), purpose = v_purpose,
    purpose_other = case when v_purpose = 'อื่นๆ' then btrim(p_booking->>'purpose_other') end,
    catering = array(select distinct value from jsonb_array_elements_text(coalesce(p_booking->'catering','[]'))),
    status = v_new, updated_at = clock_timestamp()
  where id = p_id;
end;
$$;

create function public.admin_conflict_details(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_vip public.bookings%rowtype;
  v_data jsonb;
begin
  perform public.require_booking_role(true);
  select * into v_vip from public.bookings where id = p_id and status = 'conflict_pending';
  if not found then raise exception 'ไม่พบรายการรอสลับห้อง'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'updated_at', b.updated_at, 'booker_name', b.booker_name,
    'start_time', b.start_time, 'end_time', b.end_time,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'capacity',r.capacity) order by r.name)
      from public.rooms r where r.is_active and r.id <> v_vip.room_id
        and public.booking_slot_state(r.id,b.booking_date,b.start_time,b.end_time,'admin') = 'available'
    ),'[]'::jsonb)
  ) order by b.start_time, b.id),'[]'::jsonb) into v_data
  from public.bookings b where b.room_id = v_vip.room_id and b.booking_date = v_vip.booking_date
    and b.start_time < v_vip.end_time and v_vip.start_time < b.end_time
    and b.booker_role = 'user' and b.status in ('pending','approved');
  return jsonb_build_object('version',v_vip.updated_at,'blockers',v_data);
end;
$$;

create function public.admin_resolve_conflict(p_id uuid, p_version timestamptz, p_moves jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_vip public.bookings%rowtype;
  v_b public.bookings%rowtype;
  v_move jsonb;
  v_room uuid;
  v_count integer := 0;
begin
  perform public.lock_booking_schedule();
  perform public.require_booking_role(true);
  select * into v_vip from public.bookings where id = p_id and status = 'conflict_pending';
  if not found or v_vip.updated_at is distinct from p_version then
    raise exception 'รายการเปลี่ยนแปลงแล้ว กรุณาเปิดหน้าสลับห้องใหม่';
  end if;
  if not exists (select 1 from public.rooms where id = v_vip.room_id and is_active) then
    raise exception 'ห้องเดิมปิดใช้งาน กรุณาแก้ไขห้องของคำขอ';
  end if;
  for v_b in select * from public.bookings b
    where b.room_id = v_vip.room_id and b.booking_date = v_vip.booking_date
      and b.start_time < v_vip.end_time and v_vip.start_time < b.end_time
      and b.status <> 'cancelled' and b.id <> v_vip.id
    order by b.start_time,b.id
  loop
    select entry into v_move from jsonb_array_elements(p_moves) entry where entry->>'id' = v_b.id::text;
    if not found or v_b.booker_role <> 'user' or v_b.status not in ('pending','approved')
      or v_b.updated_at is distinct from (v_move->>'updated_at')::timestamptz then
      raise exception 'คิวเดิมเปลี่ยนแปลงแล้ว กรุณาเปิดหน้าสลับห้องใหม่';
    end if;
    v_room := (v_move->>'room_id')::uuid;
    if v_room = v_vip.room_id or not exists (select 1 from public.rooms where id = v_room and is_active)
      or public.booking_slot_state(v_room,v_b.booking_date,v_b.start_time,v_b.end_time,'admin') <> 'available' then
      raise exception 'ห้องปลายทางไม่ว่างหรือปิดใช้งาน กรุณาเลือกห้องใหม่';
    end if;
    update public.bookings set room_id = v_room, updated_at = clock_timestamp() where id = v_b.id;
    v_count := v_count + 1;
  end loop;
  if v_count is distinct from jsonb_array_length(p_moves) then
    raise exception 'คิวเดิมเปลี่ยนแปลงแล้ว กรุณาเปิดหน้าสลับห้องใหม่';
  end if;
  update public.bookings set status = 'approved', updated_at = clock_timestamp() where id = p_id;
end;
$$;

-- Profile changes originating in the privileged Auth Admin API happen in the same Auth transaction.
create function public.sync_managed_booking_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_profile jsonb := new.raw_app_meta_data->'meeting_booking_profile';
  v_actor public.app_role;
  v_role public.app_role;
begin
  if v_profile is null or (
    tg_op = 'UPDATE' and v_profile is not distinct from old.raw_app_meta_data->'meeting_booking_profile'
  ) then return new; end if;
  perform public.lock_booking_schedule();
  select role into v_actor from public.users where id = (v_profile->>'actor')::uuid;
  if v_actor is distinct from 'admin'::public.app_role then
    raise exception 'ผู้ดำเนินการไม่มีสิทธิ์จัดการผู้ใช้งาน';
  end if;
  v_role := (v_profile->>'role')::public.app_role;
  if v_role <> 'admin' and exists (select 1 from public.users where id = new.id and role = 'admin')
    and not exists (select 1 from public.users where id <> new.id and role = 'admin') then
    raise exception 'ระบบต้องมีผู้ดูแลอย่างน้อยหนึ่งบัญชี';
  end if;
  insert into public.users(id, full_name, department, role)
    values (new.id,btrim(v_profile->>'full_name'),btrim(v_profile->>'department'),v_role)
  on conflict (id) do update set full_name = excluded.full_name,
    department = excluded.department, role = excluded.role;
  return new;
end;
$$;

-- PostgreSQL orders triggers of the same kind by name, so creation runs before sync.
create trigger sync_booking_profile after insert or update of raw_app_meta_data on auth.users
for each row execute function public.sync_managed_booking_profile();

revoke all on function public.require_booking_role(boolean),
  public.lock_booking_schedule(), public.booking_slot_state(uuid,date,time,time,public.app_role,uuid),
  public.sync_managed_booking_profile() from public, anon, authenticated;

revoke all on function public.preview_booking(jsonb,date[]),
  public.submit_booking(jsonb,date[],boolean,jsonb,uuid),
  public.booking_history(integer,boolean,text), public.booking_overview(date,date),
  public.admin_room_save(jsonb), public.admin_action(text,uuid,boolean),
  public.admin_edit_booking(uuid,timestamptz,jsonb), public.admin_conflict_details(uuid),
  public.admin_resolve_conflict(uuid,timestamptz,jsonb) from public, anon, authenticated;

grant execute on function public.preview_booking(jsonb,date[]),
  public.submit_booking(jsonb,date[],boolean,jsonb,uuid),
  public.booking_history(integer,boolean,text), public.booking_overview(date,date),
  public.admin_room_save(jsonb), public.admin_action(text,uuid,boolean),
  public.admin_edit_booking(uuid,timestamptz,jsonb), public.admin_conflict_details(uuid),
  public.admin_resolve_conflict(uuid,timestamptz,jsonb) to authenticated;
create function public.admin_queue_summary()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_booking_role(true);
  return (select jsonb_build_object(
    'pending',count(*) filter (where status = 'pending'),
    'conflicts',count(*) filter (where status = 'conflict_pending')
  ) from public.bookings where status in ('pending','conflict_pending'));
end;
$$;

create function public.admin_room_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lock_booking_schedule();
  perform public.require_booking_role(true);
  update public.rooms set is_active = p_active where id = p_id;
  if not found then raise exception 'ไม่พบห้องประชุม'; end if;
end;
$$;

revoke all on function public.admin_queue_summary(), public.admin_room_set_active(uuid,boolean)
from public, anon, authenticated;
grant execute on function public.admin_queue_summary(), public.admin_room_set_active(uuid,boolean)
to authenticated;
commit;
