-- สร้างบัญชีใน Authentication > Users ก่อน แล้วแก้อีเมล ชื่อ และหน่วยงานในบรรทัดด้านล่าง
do $$
declare
  v_email text := 'your-admin@example.com';
  v_name text := 'ชื่อและนามสกุลผู้ดูแล';
  v_department text := 'ชื่อหน่วยงาน';
begin
  update public.users p
  set role = 'admin', full_name = v_name, department = v_department
  from auth.users u
  where p.id = u.id and lower(u.email) = lower(v_email);
  if not found then raise exception 'ไม่พบบัญชี กรุณาตรวจสอบอีเมลใน Authentication'; end if;
end;
$$;
