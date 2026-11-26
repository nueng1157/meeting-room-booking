-- Run once after 02-booking-functions.sql. Existing bookings keep a null display title.
begin;

alter table public.bookings add column display_title text
  check (display_title is null or length(display_title) between 1 and 140);

alter function public.submit_booking(jsonb,date[],boolean,jsonb,uuid) rename to submit_booking_core;
alter function public.admin_edit_booking(uuid,timestamptz,jsonb) rename to admin_edit_booking_core;

revoke all on function public.submit_booking_core(jsonb,date[],boolean,jsonb,uuid),
  public.admin_edit_booking_core(uuid,timestamptz,jsonb) from public, anon, authenticated;

create function public.submit_booking(
  p_booking jsonb, p_dates date[], p_weekly boolean, p_preview jsonb, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_title text := nullif(btrim(p_booking->>'display_title'), '');
  v_result jsonb;
begin
  v_result := public.submit_booking_core(p_booking,p_dates,p_weekly,p_preview,p_request_id);
  if v_title is not null and (v_result->>'created')::integer > 0
     and not coalesce((v_result->>'replayed')::boolean, false) then
    update public.bookings set display_title = v_title
    where user_id = auth.uid() and request_id = p_request_id;
  end if;
  return v_result;
end;
$$;

create function public.admin_edit_booking(p_id uuid, p_version timestamptz, p_booking jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_edit_booking_core(p_id,p_version,p_booking);
  if p_booking ? 'display_title' then
    update public.bookings set display_title = nullif(btrim(p_booking->>'display_title'), '')
    where id = p_id;
  end if;
end;
$$;

create function public.admin_tv_schedule(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_result jsonb;
begin
  perform public.require_booking_role(true);
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_to < p_from or p_to - p_from > 31 then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  with counts as (
    select booking_date, count(*) as count
    from public.bookings
    where status = 'approved' and booking_date between p_from and p_to
    group by booking_date
  ), schedule as (
    select b.id, b.booking_date, b.start_time, b.end_time, r.name as room_name,
      coalesce(b.display_title, b.purpose::text) as title
    from public.bookings b join public.rooms r on r.id = b.room_id
    where b.status = 'approved'
      and (b.booking_date = v_today or (p_from = p_to and b.booking_date = p_from))
  )
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(booking_date, count) from counts), '{}'::jsonb),
    'today', coalesce((select jsonb_agg(to_jsonb(s) order by start_time,room_name,id)
      from schedule s where booking_date = v_today), '[]'::jsonb),
    'selected_day', coalesce((select jsonb_agg(to_jsonb(s) order by start_time,room_name,id)
      from schedule s where p_from = p_to and booking_date = p_from), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.submit_booking(jsonb,date[],boolean,jsonb,uuid),
  public.admin_edit_booking(uuid,timestamptz,jsonb), public.admin_tv_schedule(date,date)
from public, anon, authenticated;
grant execute on function public.submit_booking(jsonb,date[],boolean,jsonb,uuid),
  public.admin_edit_booking(uuid,timestamptz,jsonb), public.admin_tv_schedule(date,date)
to authenticated;
notify pgrst, 'reload schema';
commit;
