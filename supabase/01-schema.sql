begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions, pg_catalog;

create type public.app_role as enum ('user','vip_edu','admin');
create type public.booking_status as enum ('pending','approved','conflict_pending','cancelled');
create type public.booking_purpose as enum ('ประชุม','อบรม','สอน','ปฐมนิเทศนักเรียน','Open House','สัมมนา','อื่นๆ');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 180),
  capacity integer not null check (capacity > 0),
  equipment text[] not null default '{}',
  is_active boolean not null default true
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 180),
  department text not null default '' check (length(department) <= 180),
  role public.app_role not null default 'user',
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id),
  user_id uuid not null references public.users(id),
  booker_role public.app_role not null,
  booking_date date not null,
  start_time time(0) not null,
  end_time time(0) not null,
  booker_name text not null check (length(btrim(booker_name)) between 1 and 180),
  email text not null check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  phone text not null check (length(btrim(phone)) between 1 and 40),
  actual_user text not null check (length(btrim(actual_user)) between 1 and 180),
  purpose public.booking_purpose not null,
  purpose_other text check (length(purpose_other) <= 500),
  catering text[] not null default '{}' check (catering <@ array['อาหารว่าง','อาหารกลางวัน','กาแฟ']::text[]),
  status public.booking_status not null default 'pending',
  recurring_group_id uuid,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time and end_time < time '24:00'),
  check ((purpose = 'อื่นๆ' and coalesce(length(btrim(purpose_other)),0) > 0)
    or (purpose <> 'อื่นๆ' and purpose_other is null)),
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    tsrange(booking_date + start_time, booking_date + end_time, '[)') with &&
  ) where (status in ('pending','approved'))
);

create index bookings_room_date on public.bookings(room_id, booking_date)
  where status <> 'cancelled';
create index bookings_own on public.bookings(user_id, created_at desc, id);
create index bookings_requests on public.bookings(user_id, request_id);
create index bookings_created on public.bookings(created_at desc, id);
create index bookings_group on public.bookings(recurring_group_id) where recurring_group_id is not null;

create function public.create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users(id, full_name, department)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''),180),
    left(coalesce(new.raw_user_meta_data->>'department',''),180));
  return new;
end;
$$;

create trigger create_booking_profile after insert on auth.users
for each row execute function public.create_profile();

insert into public.users(id, full_name, department)
select id, left(coalesce(raw_user_meta_data->>'full_name',''),180),
  left(coalesce(raw_user_meta_data->>'department',''),180)
from auth.users on conflict (id) do nothing;

create function public.current_booking_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.users where id = auth.uid()
$$;

alter table public.rooms enable row level security;
alter table public.users enable row level security;
alter table public.bookings enable row level security;

create policy rooms_read on public.rooms for select to authenticated
using (public.current_booking_role() is not null and (is_active or public.current_booking_role() = 'admin'));
create policy users_read on public.users for select to authenticated
using (id = auth.uid() or public.current_booking_role() = 'admin');
create policy bookings_read on public.bookings for select to authenticated
using (user_id = auth.uid() or public.current_booking_role() = 'admin');

revoke all on public.rooms, public.users, public.bookings from public, anon, authenticated;
grant select on public.rooms, public.users, public.bookings to authenticated;
grant select on public.users to service_role;
revoke all on function public.create_profile() from public, anon, authenticated;
revoke all on function public.current_booking_role() from public, anon, authenticated;
grant execute on function public.current_booking_role() to authenticated;
commit;
