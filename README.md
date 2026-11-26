# ระบบจองห้องประชุมออนไลน์

เว็บภาษาไทยสำหรับบุคลากรและผู้ดูแล ใช้ React, Vite, Tailwind CSS, Lucide React, Recharts และ Supabase Auth + PostgreSQL หน้าเว็บ Deploy บน GitHub Pages ได้โดยใช้ GitHub Actions เวลาในระบบอ้างอิง Asia/Bangkok

## ไฟล์ที่ใช้ติดตั้ง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `src/` | หน้าเข้าสู่ระบบ ฟอร์มจอง ปฏิทิน Dashboard และหน้าผู้ดูแล |
| `supabase/01-schema.sql` | สร้าง `rooms`, `users`, `bookings` พร้อมดัชนี RLS และข้อกำหนดกันเวลาซ้อน |
| `supabase/02-booking-functions.sql` | ตรวจคิว บันทึกคำขอ อนุมัติ ย้ายห้อง และซิงก์โปรไฟล์จาก Supabase Auth |
| `supabase/03-seed-rooms.sql` | ข้อมูลห้องประชุม 9 ห้อง |
| `supabase/04-first-admin.sql` | ตั้งบัญชีผู้ดูแลคนแรก |
| `supabase/05-tv-display.sql` | เพิ่มช่องหัวข้อและคำสั่งอ่านข้อมูลสำหรับจอทีวี |
| `supabase/functions/manage-users/index.ts` | Supabase Edge Function สำหรับจัดการบัญชี |
| `.env.example` | ตัวอย่างค่าที่ใช้เชื่อมหน้าเว็บกับ Supabase |
| `.github/workflows/pages.yml` | Build, ทดสอบ และ Deploy หน้าเว็บ |
| `tests/` | ทดสอบคำนวณวันที่และกฎการจองบน PostgreSQL (PGlite) |

## 1. สร้าง Supabase และเตรียมฐานข้อมูล

1. แตกไฟล์ ZIP แล้วเปิดโฟลเดอร์ `meeting-room-booking` ใน VS Code
2. เข้า [Supabase Dashboard](https://supabase.com/dashboard) แล้วสร้างโปรเจกต์ใหม่
3. เปิด **SQL Editor → New query** คัดลอกเนื้อหาและกด **Run** ทีละไฟล์ตามลำดับ `01-schema.sql` → `02-booking-functions.sql` → `03-seed-rooms.sql` → `05-tv-display.sql` ไฟล์สร้างตารางและฟังก์ชันใช้ครั้งเดียวต่อฐานข้อมูลใหม่ ส่วนไฟล์ seed รันซ้ำได้
4. เปิด **Table Editor → rooms** แล้วตรวจว่ามี 9 ห้อง โดยห้องบรรยาย 5/1-2 จุ 50 คน ห้องประชุมกุมาร 5 จุ 40 คน และห้องประชุมชนิกา ตู้จินดา จุ 20 คน
5. ใน **Authentication** เปิด Email provider และปิด **Allow new users to sign up** เพื่อให้สร้างบัญชีได้ผ่านผู้ดูแลเท่านั้น
6. เปิด **Authentication → Users → Add user → Create new user** สร้างบัญชีผู้ดูแลคนแรกด้วยอีเมลและรหัสผ่าน ตั้งให้ยืนยันอีเมลแล้วผ่านตัวเลือก **Auto Confirm User** ถ้ามี
7. เปิดไฟล์ `04-first-admin.sql` แก้อีเมล ชื่อ และหน่วยงานให้ตรงกับบัญชีที่สร้าง แล้วนำไปรันใน SQL Editor ตรวจใน **Table Editor → users** ว่าบัญชีนี้มี `role = admin`

ตาราง `public.users` เก็บชื่อ หน่วยงาน และสิทธิ์ ส่วนอีเมลสำหรับเข้าสู่ระบบและรหัสผ่านอยู่ใน Supabase Auth ตาราง `public.bookings` เก็บอีเมลและเบอร์ติดต่อที่กรอกในแต่ละครั้ง ผู้ใช้งานเห็นรายละเอียดการจองของตนเอง ส่วนปฏิทินรวมแสดงเฉพาะข้อมูลช่วงเวลาและห้อง โดยไม่แสดงชื่อ อีเมล หรือเบอร์โทร

## 2. Deploy ฟังก์ชันจัดการบัญชี

ติดตั้ง Node.js 24 แล้วเปิด Terminal ที่โฟลเดอร์โปรเจกต์ ใช้ Project Reference จากหน้า Project Settings ของ Supabase

```bash
npx supabase login
npx supabase functions deploy manage-users --project-ref YOUR_PROJECT_REF
```

ฟังก์ชันใช้ค่าฝั่งเซิร์ฟเวอร์ `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ที่ Supabase เตรียมให้ การตั้งค่า `verify_jwt = false` ใน `supabase/config.toml` ให้ฟังก์ชันตรวจ access token ด้วย Supabase Auth ภายในทุกคำขอที่เข้าถึงข้อมูล จากนั้นตรวจบทบาทของผู้ขอในฐานข้อมูล ห้ามใส่ Service Role หรือ Secret Key ในไฟล์ `.env` ของ Vite และห้ามเพิ่มเป็นตัวแปรของ GitHub Pages

## 3. ทดลองเปิดบนเครื่อง

1. คัดลอก `.env.example` เป็น `.env` ที่โฟลเดอร์โปรเจกต์
2. เปิดหน้า **Connect** หรือ **Project Settings → API Keys** ของ Supabase แล้วกรอก Project URL และ Publishable Key
3. รันคำสั่งด้านล่าง แล้วเปิด URL ที่ Terminal แสดง ปกติคือ `http://localhost:5173`

```bash
npm ci
npm test
npm run dev
```

คำสั่ง `npm run build` สร้างเว็บไซต์ใน `dist/` และ `npm run preview` เปิดผล Build บนเครื่อง ทดสอบด้วยบัญชี Admin ที่สร้างไว้ แล้วเข้า **ผู้ใช้งาน → เพิ่มผู้ใช้งาน** สร้างอย่างน้อยหนึ่งบัญชีทั่วไปและหนึ่งบัญชีหน่วยการศึกษา ผู้ใช้งานเปลี่ยนรหัสผ่านได้ผ่านไอคอนกุญแจข้างปุ่มออกจากระบบ

## 4. Deploy บน GitHub Pages

1. สร้าง repository ใน GitHub แล้วอัปโหลดไฟล์ **ภายใน** โฟลเดอร์ `meeting-room-booking` ไปที่รากของ branch `main` ให้ `package.json`, `src/` และ `.github/workflows/pages.yml` อยู่ในระดับเดียวกัน อย่าอัปโหลด `.env`, `node_modules/` หรือ `dist/`
2. ไปที่ **Settings → Secrets and variables → Actions → Variables → New repository variable** เพิ่ม `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY` โดยใช้ค่าเดียวกับที่กรอกใน `.env`
3. ไปที่ **Settings → Pages → Build and deployment → Source** เลือก **GitHub Actions**
4. ไปที่ **Actions → Deploy to GitHub Pages → Run workflow** แล้วเลือก `main` หาก repository ใช้ branch อื่น ให้แก้ `branches: [main]` ใน workflow เป็น branch ที่ต้องการ
5. เมื่อทั้งงาน `build` และ `deploy` สำเร็จ เปิด URL จากหน้า **Settings → Pages** เช่น `https://YOUR_ACCOUNT.github.io/meeting-room-booking/`
6. ใน Supabase เปิด **Authentication → URL Configuration** ตั้ง Site URL เป็น URL ที่ Deploy แล้ว ทดสอบเข้าสู่ระบบจาก URL จริงและลองสร้างบัญชีทดสอบในหน้าผู้ดูแลเพื่อตรวจว่า Edge Function ใช้งานได้

หากเปิดหน้าเว็บได้แต่ขึ้นข้อความว่า Supabase ยังไม่ได้ตั้งค่า ตรวจชื่อและค่าตัวแปรทั้งสองแล้วรัน workflow ใหม่ ค่าของ Vite ถูกอ่านในขั้นตอน Build หากเปิดหน้าจัดการบัญชีไม่ได้ ตรวจว่าฟังก์ชัน `manage-users` ถูก Deploy ใน Supabase โปรเจกต์เดียวกับหน้าเว็บ

## 5. หลักการทำงาน

- คิว `pending` และ `approved` กันช่วงเวลาซ้อน เวลาสิ้นสุดของคิวหนึ่งตรงกับเวลาเริ่มของคิวถัดไปได้
- ผู้ใช้งานทั่วไปและผู้ดูแลที่จองผ่านฟอร์มส่งคำขอ `pending` ได้เมื่อห้องว่าง ผู้ใช้ `vip_edu` ส่งคำขอ `conflict_pending` ได้เมื่อทุกคิวที่ชนเป็นคิวของผู้ใช้ทั่วไป โดยอ้างอิงสิทธิ์ ณ เวลาที่คิวนั้นถูกสร้าง เมื่อมีคำขอแทรกคิวรอพิจารณา ช่วงที่ทับกับคำขอนั้นจะพักรับคำขอซ้อนเพิ่ม
- ระบบจองรายสัปดาห์สร้างคำขอตามวันที่ว่างและวันที่แทรกคิวได้ ใช้ `recurring_group_id` เป็นค่าเดียวกันทั้งชุด ตอนยืนยันฐานข้อมูลตรวจคิวอีกครั้ง หากผลเปลี่ยน ระบบแสดงผลล่าสุดให้ตรวจและยืนยันใหม่
- รายการชนแจ้งผ่านตัวเลขบนเมนู **จัดการคิว** ซึ่งอัปเดตทุก 30 วินาทีและเมื่อกลับมาที่หน้าต่าง ผู้ดูแลเลือกห้องปลายทางให้แต่ละคิวที่ชน แล้วกด **ย้ายคิวเดิมและอนุมัติ** ครั้งเดียว คิวเดิมอยู่วันและเวลาเดิมและมีสถานะเดิม การย้ายทุกคิวและการอนุมัติ VIP ทำในธุรกรรมเดียว
- การอนุมัติทั้งชุดจะสำเร็จเมื่อทุกคำขอในชุดที่รออนุมัติพร้อมอนุมัติ หากยังมีคิวชนที่ต้องย้ายหรือห้องปิด ระบบจะคงสถานะของทั้งชุดไว้ให้ผู้ดูแลแก้ไขก่อน การยกเลิกทั้งชุดรวมรายการที่อนุมัติไปแล้ว
- การปิดห้องหยุดรับคำขอใหม่ รายการเดิมยังเปิดดู ย้าย หรือยกเลิกได้ Dashboard นับคำขอทั้งหมดในช่วงที่เลือก ยกเว้นรายการยกเลิก ห้องที่เปิดใช้งานแต่มี 0 รายการรวมในการหาห้องที่ใช้งานน้อยที่สุด

## เพิ่มจอทีวีให้ระบบที่ติดตั้งแล้ว

1. ในโปรเจกต์ Supabase เดิม เปิด **SQL Editor → New query** แล้วรันเฉพาะ `supabase/05-tv-display.sql` หนึ่งครั้ง รอให้สำเร็จก่อนเปิดเว็บเวอร์ชันนี้
2. แตก ZIP เวอร์ชันนี้ไว้คนละโฟลเดอร์กับเวอร์ชันเดิม คัดลอกไฟล์ `.env` ที่ใช้งานได้จากโฟลเดอร์เดิมมาไว้ข้าง `package.json` ในโฟลเดอร์ใหม่ หากใช้ GitHub Pages อยู่แล้ว ให้อัปเดตซอร์สใน repository และใช้ตัวแปรเดิม
3. บนเครื่องที่ต่อจอทีวี เปิดเว็บและล็อกอินบัญชีผู้ดูแล เลือก **จอทีวี** ทางซ้าย แล้วกด **เต็มจอ** ใช้ **กลับระบบ** เพื่อกลับหน้าที่เปิดก่อนหน้า

มุมมอง **รายวัน / รายสัปดาห์ / รายเดือน** นับเฉพาะรายการอนุมัติ แตะวันที่เพื่อดูเวลา ห้อง และหัวข้อของวันนั้น ด้านข้างแสดงรายการวันนี้ที่กำลังประชุมหรือยังไม่เริ่ม โดยใช้เวลาไทย ข้อมูลจองอัปเดตทุก 30 วินาที หากรายการมีหลายหน้า จอจะเปลี่ยนหน้าทุก 15 วินาทีและพักเลื่อนได้

ในฟอร์มจองและหน้าแก้ไขของผู้ดูแล ช่อง **หัวข้อสำหรับแสดงบนจอทีวี** ใช้สำหรับข้อความที่ตั้งใจให้ผู้เดินผ่านเห็น หากเว้นว่างหรือเป็นรายการจากเวอร์ชันก่อน จอใช้ชื่อประเภทกิจกรรม เช่น ประชุม อบรม หรือสอน ผู้ดูแลสามารถใส่หัวข้อให้รายการที่มีอยู่ได้จาก **จัดการคิว → ทุกสถานะ → แก้ไข**

## เอกสารอ้างอิง

- [ตั้งค่า Supabase Auth](https://supabase.com/docs/guides/auth/general-configuration)
- [อ่าน Project URL และ API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Deploy Supabase Edge Functions](https://supabase.com/docs/guides/functions/deploy)
- [การตั้งค่า GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [การ Deploy Vite](https://vite.dev/guide/static-deploy.html)
