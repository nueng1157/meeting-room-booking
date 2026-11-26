import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}

const roles = ["user", "vip_edu", "admin"];
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply({ error: "คำสั่งไม่ถูกต้อง" }, 405);
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return reply({ error: "ตั้งค่าบริการจัดการบัญชีไม่ครบ" }, 500);
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return reply({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" }, 401);
    const { data: caller, error: callerError } = await client.from("users").select("role")
      .eq("id", auth.user.id).maybeSingle();
    if (callerError) return reply({ error: "ตรวจสอบสิทธิ์ไม่สำเร็จ" }, 500);
    if (caller?.role !== "admin") return reply({ error: "เฉพาะผู้ดูแลระบบ" }, 403);

    const data = await request.json().catch(() => null);
    if (!data || typeof data !== "object") return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    if (data.action === "list") {
      const page = Number(data.page);
      if (!Number.isSafeInteger(page) || page < 1) return reply({ error: "เลขหน้าไม่ถูกต้อง" }, 400);
      const { data: accounts, error } = await client.auth.admin.listUsers({ page, perPage: 20 });
      if (error) return reply({ error: "โหลดบัญชีผู้ใช้งานไม่สำเร็จ" }, 500);
      const ids = accounts.users.map((user) => user.id);
      if (!ids.length) return reply({ users: [], hasNext: false });
      const { data: profiles, error: profileError } = await client.from("users")
        .select("id,full_name,department,role").in("id", ids);
      if (profileError) return reply({ error: "โหลดข้อมูลผู้ใช้งานไม่สำเร็จ" }, 500);
      const byId = new Map(profiles.map((profile) => [profile.id, profile]));
      return reply({
        users: accounts.users.filter((user) => byId.has(user.id))
          .map((user) => ({ ...byId.get(user.id), email: user.email ?? "" })),
        hasNext: Boolean(accounts.nextPage),
      });
    }

    if (!["create", "update"].includes(data.action)) return reply({ error: "คำสั่งไม่ถูกต้อง" }, 400);
    const creating = data.action === "create";
    const fullName = typeof data.full_name === "string" ? data.full_name.trim() : "";
    const department = typeof data.department === "string" ? data.department.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    const password = typeof data.password === "string" ? data.password : "";
    if (!fullName || fullName.length > 180 || !department || department.length > 180 ||
      !emailPattern.test(email) || email.length > 254 || !roles.includes(data.role) ||
      (!creating && !idPattern.test(data.id))) {
      return reply({ error: "กรุณาตรวจสอบชื่อ หน่วยงาน อีเมล และสิทธิ์ผู้ใช้งาน" }, 400);
    }
    const passwordBytes = new TextEncoder().encode(password).length;
    if ((creating || password) && (password.length < 12 || passwordBytes > 72)) {
      return reply({ error: "รหัสผ่านต้องยาวอย่างน้อย 12 ตัวอักษร และมีขนาดไม่เกิน 72 ไบต์" }, 400);
    }
    const attributes = {
      email, email_confirm: true,
      ...(password ? { password } : {}),
      app_metadata: {
        meeting_booking_profile: { full_name: fullName, department, role: data.role, actor: auth.user.id },
      },
    };
    const result = creating
      ? await client.auth.admin.createUser(attributes)
      : await client.auth.admin.updateUserById(data.id, attributes);
    if (result.error) {
      const messages: Record<string, string> = {
        email_exists: "อีเมลนี้มีบัญชีอยู่แล้ว",
        user_not_found: "ไม่พบบัญชีผู้ใช้งาน",
        weak_password: "รหัสผ่านไม่ผ่านเงื่อนไขของ Supabase",
      };
      const message = messages[result.error.code ?? ""] ??
        "บันทึกบัญชีไม่สำเร็จ ตรวจสอบว่าอีเมลไม่ซ้ำและมีผู้ดูแลอย่างน้อยหนึ่งบัญชี";
      return reply({ error: message }, 400);
    }
    return reply({ ok: true });
  } catch {
    return reply({ error: "ระบบจัดการบัญชีทำงานไม่สำเร็จ" }, 500);
  }
});
