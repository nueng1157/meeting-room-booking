import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const client = url && /^https?:\/\/[^\s]+$/.test(url)
  && !url.includes('YOUR_PROJECT_REF') && key && !key.includes('REPLACE_ME')
  ? createClient(url, key) : null;

export function explain(error) {
  const message = error?.message ?? '';
  if (/[\u0E00-\u0E7F]/.test(message)) return message;
  const messages = {
    invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    email_not_confirmed: 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล',
    weak_password: 'รหัสผ่านไม่ผ่านเงื่อนไขของ Supabase',
    same_password: 'กรุณาใช้รหัสผ่านที่แตกต่างจากเดิม',
    23505: 'พบข้อมูลซ้ำ กรุณาตรวจสอบชื่อหรืออีเมล',
    23514: 'ข้อมูลไม่ตรงตามเงื่อนไข กรุณาตรวจสอบรายละเอียดอีกครั้ง',
    '23P01': 'ช่วงเวลานี้มีการจองแล้ว กรุณาโหลดข้อมูลใหม่',
    42501: 'คุณไม่มีสิทธิ์ดำเนินการ',
  };
  return messages[error?.code] ?? 'ดำเนินการไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง';
}

async function result(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
export const rpc = (name, parameters) => result(client.rpc(name, parameters));
export const loadProfile = (id) => result(client.from('users').select('*').eq('id', id).single());
export async function loadRooms() {
  const rooms = [];
  for (let offset = 0; ; offset += 100) {
    const page = await result(client.from('rooms').select('*').order('name').range(offset, offset + 99));
    rooms.push(...page);
    if (page.length < 100) return rooms;
  }
}
export async function manageUsers(body) {
  const { data, error } = await client.functions.invoke('manage-users', { body });
  if (error) {
    const details = await error.context?.json?.().catch(() => null);
    throw new Error(details?.error ?? 'ติดต่อระบบจัดการบัญชีไม่สำเร็จ กรุณาตรวจสอบการตั้งค่า Edge Function');
  }
  return data;
}
