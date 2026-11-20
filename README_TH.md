# QUEUE CHECK

เว็บแอปจัดการคิว F001–F400 และ A001–A250 พร้อมระบบ Check / Canceled, คิวที่ข้าม, ประวัติรายบุคคล, สรุปรายเดือน และจัดการรายชื่อเจ้าหน้าที่

## เทคโนโลยี

- React + Vite
- Tailwind CSS
- Firebase Authentication (Anonymous)
- Cloud Firestore
- PWA ผ่าน `vite-plugin-pwa`
- Hosting: Vercel

## เงื่อนไขการทำงานที่ติดตั้งไว้

1. เปิดเว็บไซต์แล้วพบหน้า Login ทันที โดยเลือกชื่อจาก Dropdown และเข้าสู่หน้าคิวทันที ไม่ต้องมีหน้า Overview
2. หน้า Queue ใช้วันที่ปัจจุบันของประเทศไทย (`Asia/Bangkok`) อัตโนมัติ ไม่มีตัวเลือกวันที่สำหรับบันทึกคิว
3. คิว F มี 400 คิว และ A มี 250 คิว แสดงเป็น 2 คอลัมน์ พร้อมปุ่ม Check และ Canceled ทุกคิว
4. เมื่อ Check หรือ Canceled คิวเลขที่สูงกว่า คิวเลขที่ต่ำกว่าซึ่งยังไม่ถูกดำเนินการจะถูกคำนวณเป็น “คิวที่ข้าม” และแสดงในส่วนแยกด้านล่างโดยใช้การจัดเรียงแบบ wrap ไม่มีกรอบ Scrollbar ของตัวเอง
5. คิวที่ข้ามสามารถ Check หรือ Canceled ได้เช่นเดียวกับคิวปกติ
6. Check = 1 คะแนน, Canceled = 0 คะแนน และไม่แสดงคะแนน 0/1 ในตารางประวัติรวม
7. หน้า History มีประวัติรวมแยกคอลัมน์ F/A เรียงเลขคิวจากมากไปน้อย พร้อมชื่อเจ้าหน้าที่ สถานะ และปุ่ม “คืนคิว”
8. คืนคิวแล้วรายการจะถูกนำออกจากสถานะที่ดำเนินการแล้วและกลับไปคำนวณตำแหน่งบนหน้าหลัก หากมีคิวเลขที่สูงกว่าที่ดำเนินการแล้ว คิวที่คืนจะอยู่ใน “คิวที่ข้าม”; ถ้ายังไม่มีคิวเลขที่สูงกว่าผ่านไป คิวจะอยู่ในคิวปกติ
9. เหตุการณ์เดิมจะยังถูกเก็บไว้ใน `queueEvents` เพื่อการตรวจสอบย้อนหลัง แม้คืนคิวแล้ว โดยคะแนนและประวัติปัจจุบันคำนวณจาก `queueStates`
10. หน้า History มีประวัติรายบุคคล คะแนนรายวัน, ประวัติรายเดือน และส่วนจัดการเจ้าหน้าที่อยู่ถัดจากประวัติรายเดือน
11. เปลี่ยนชื่อเจ้าหน้าที่แล้วข้อมูลประวัติเดิมยังคงชื่อที่บันทึกไว้ในขณะดำเนินการ
12. การเปลี่ยนวันอ้างอิงวันที่ประเทศไทยโดยอัตโนมัติ คิวและคะแนนจะเริ่มรอบใหม่ตามวันที่ใหม่ โดยไม่ต้องสร้างเอกสารคิวล่วงหน้าหลายร้อยรายการ

---

## 1) สร้าง Firebase โปรเจกต์ใหม่

1. เปิด https://console.firebase.google.com/ แล้วสร้าง Project ใหม่
2. ไปที่ **Build → Authentication → Get started → Sign-in method**
3. เปิดวิธีเข้าสู่ระบบ **Anonymous** แล้วบันทึก
4. ไปที่ **Build → Firestore Database → Create database** แล้วสร้างฐานข้อมูล
5. ใน Firestore Rules ให้วางเนื้อหาจากไฟล์ `firestore.rules` แล้วกด Publish
6. ไปที่ Project settings → General → Your apps → Add app → Web เพื่อสร้าง Web App
7. คัดลอกค่าจาก Firebase SDK config มาใส่ใน `.env.local` ตามตัวอย่างด้านล่าง

### ตั้งค่า `.env.local`

คัดลอก `.env.example` เป็นไฟล์ชื่อ `.env.local` แล้วแทนค่าตัวอย่างด้วยค่าจริงจาก Firebase Web App config

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

หมายเหตุ: ค่า `storageBucket` ให้ใช้ค่าที่ Firebase แสดงจริง อาจลงท้ายด้วย `appspot.com` หรือ `firebasestorage.app` ตามโปรเจกต์

## 2) เปิดใช้งานในเครื่อง

ต้องติดตั้ง Node.js รุ่น LTS ก่อน จากนั้นเปิด Terminal ในโฟลเดอร์โปรเจกต์แล้วรัน

```bash
npm install
npm run dev
```

Vite จะแสดง URL สำหรับเปิดทดสอบ เช่น `http://localhost:5173`

## 3) เพิ่มรายชื่อเจ้าหน้าที่ครั้งแรก

- เมื่อเปิดเว็บและ Firestore ยังไม่มีรายชื่อเจ้าหน้าที่ ระบบจะแสดงช่องเพิ่มชื่อเจ้าหน้าที่คนแรกบนหน้า Login
- หลังจากนั้นการเพิ่ม แก้ไข หรือปิดใช้งานเจ้าหน้าที่ทำได้ที่หน้า History ส่วนล่างสุด
- การปิดใช้งานจะไม่ลบประวัติเดิม และชื่อเจ้าหน้าที่ที่บันทึกไว้ในประวัติจะไม่เปลี่ยนตามชื่อใหม่

## 4) Deploy ผ่าน GitHub และ Vercel

### GitHub

1. สร้าง Repository ใหม่บน https://github.com/
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ (ไม่ต้องอัปโหลด `node_modules`, `dist` หรือ `.env.local`)
3. Commit และ Push ขึ้น Repository

หากใช้ Terminal:

```bash
git init
git add .
git commit -m "Initial QUEUE CHECK app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/queue-check.git
git push -u origin main
```

แทน `YOUR-USERNAME` ด้วยชื่อบัญชี GitHub ของคุณ

### Vercel

1. เปิด https://vercel.com/ แล้ว Sign up / Sign in ด้วย GitHub
2. เลือก **Add New → Project** แล้ว Import Repository `queue-check`
3. Framework จะตรวจพบเป็น Vite โดยอัตโนมัติ
4. ก่อน Deploy ให้เพิ่ม Environment Variables ต่อไปนี้ใน Vercel Project Settings → Environment Variables:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
5. กด Deploy
6. เมื่อแก้โค้ดและ Push ไป GitHub branch ที่เชื่อมไว้ Vercel จะ Build และ Deploy เวอร์ชันใหม่ให้อัตโนมัติ

ถ้าเพิ่มหรือแก้ Environment Variables ภายหลัง ให้สั่ง Redeploy เพื่อให้ค่าใหม่ถูกนำไปใช้

## 5) โครงสร้าง Firestore

### `staff`

```js
{
  name: "ชื่อเจ้าหน้าที่",
  active: true,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### `queueStates`

เก็บสถานะปัจจุบันของคิวที่ถูกดำเนินการแล้วเท่านั้น คิวที่ยังไม่ดำเนินการไม่ต้องสร้างเอกสารล่วงหน้า

```js
{
  date: "2026-11-20",       // วันที่ประเทศไทย YYYY-MM-DD
  type: "F",                // F หรือ A
  queueNumber: 3,            // ตัวเลขสำหรับเรียงและคำนวณคิวที่ข้าม
  queue: "F003",
  status: "checked",        // checked หรือ canceled
  score: 1,                  // checked = 1, canceled = 0
  staffId: "staff-document-id",
  staffName: "ชื่อเจ้าหน้าที่ ณ เวลาที่ทำรายการ",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Document ID เป็นรูปแบบ `YYYY-MM-DD_F_003` หรือ `YYYY-MM-DD_A_003` เพื่อให้ Transaction ป้องกันการบันทึกคิวเดียวกันซ้ำได้

### `queueEvents`

เก็บ Audit log แบบเพิ่มรายการใหม่ทุกครั้ง ได้แก่ `checked`, `canceled` และ `reopened` โดยไม่ลบเหตุการณ์เดิมเมื่อคืนคิว

## 6) ข้อควรทราบด้านความปลอดภัย

- หน้า Login แบบ Dropdown เป็นการเลือกชื่อเพื่อระบุผู้บันทึก ไม่ใช่การยืนยันตัวตนด้วยรหัสผ่าน
- โปรเจกต์นี้เปิด Firebase Anonymous Authentication และ Firestore Rules อนุญาตเฉพาะคำขอที่ผ่าน Firebase Authentication เท่านั้น แต่เนื่องจากผู้เข้าชมเว็บสามารถสร้าง Anonymous session ได้ จึง **ยังไม่ใช่ระบบกำหนดสิทธิ์รายบุคคลอย่างแท้จริง** ผู้ใช้ที่เข้าถึงเว็บอาจพยายามเรียกฐานข้อมูลโดยตรงหรือปลอมชื่อเจ้าหน้าที่ได้
- ห้ามใส่ข้อมูลระบุตัวผู้ป่วย เลข HN ชื่อผู้ป่วย หรือข้อมูลสุขภาพที่เป็นความลับในระบบนี้
- ก่อนใช้งานจริงในโรงพยาบาล ควรเพิ่ม PIN/บัญชีเจ้าหน้าที่และสิทธิ์ผู้ดูแลผ่านระบบ Backend หรือ Firebase Custom Claims พร้อม Firebase App Check และตรวจสอบข้อกำหนดความปลอดภัยของหน่วยงาน
- Firebase Web API key เป็นค่าระบุโปรเจกต์ ไม่ใช่รหัสผ่าน แต่ต้องใช้ Firestore Rules, Authentication และ App Check ประกอบกัน

## 7) การแก้ปัญหาเบื้องต้น

- ขึ้นข้อความ “ยังไม่ได้ตั้งค่า Firebase”: ตรวจชื่อไฟล์ `.env.local` และค่าตัวแปร VITE ทั้ง 6 ค่า
- เข้าสู่ระบบไม่ได้: ตรวจว่าเปิด Anonymous Authentication แล้ว
- Permission denied: ตรวจว่า Publish `firestore.rules` แล้วและผู้ใช้ได้รับ Anonymous session
- หน้าเว็บเปิดแต่ Refresh แล้ว 404: ตรวจว่าใช้ `vercel.json` ที่มากับโปรเจกต์
- เปลี่ยนค่า Environment Variables ใน Vercel แล้วค่าไม่เปลี่ยน: ต้อง Redeploy
