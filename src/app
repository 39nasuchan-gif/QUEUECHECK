import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, CalendarDays, Check, ChevronDown,
  ClipboardCheck, Clock3, LogOut, Plus, RotateCcw, ShieldAlert,
  Users, X, History as HistoryIcon, ListChecks, LoaderCircle
} from 'lucide-react';
import {
  addDoc, collection, doc, onSnapshot, query, runTransaction,
  serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from './firebase.js';

const QUEUE_LIMITS = { F: 400, A: 250 };
const STORAGE_KEY = 'currentUser';

function bangkokDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function formatThaiDate(dateValue) {
  if (!dateValue) return '-';
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok'
  }).format(new Date(Date.UTC(year, month - 1, day, 5)));
}

function queueLabel(type, number) {
  return `${type}${String(number).padStart(3, '0')}`;
}

function queueDocId(date, type, number) {
  return `${date}_${type}_${String(number).padStart(3, '0')}`;
}

function readStoredUser() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function sortQueueDescending(a, b) {
  return (b.queueNumber ?? 0) - (a.queueNumber ?? 0);
}

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [staff, setStaff] = useState([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [user, setUser] = useState(readStoredUser);
  const [today, setToday] = useState(() => bangkokDate());
  const [dayStates, setDayStates] = useState([]);
  const [dayLoaded, setDayLoaded] = useState(false);
  const [page, setPage] = useState('queue');
  const [busyKey, setBusyKey] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, kind = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = bangkokDate();
      setToday((old) => old === current ? old : current);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return undefined;
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setAuthReady(true);
        setAuthError('');
      } else {
        signInAnonymously(auth).catch((error) => {
          setAuthError(error.message || 'ไม่สามารถเชื่อมต่อ Firebase Authentication ได้');
          setAuthReady(true);
        });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authReady || !db) return undefined;
    const staffQuery = query(collection(db, 'staff'));
    const unsubscribe = onSnapshot(staffQuery, (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
      setStaff(rows);
      setStaffLoaded(true);
    }, (error) => {
      showToast(`อ่านรายชื่อเจ้าหน้าที่ไม่สำเร็จ: ${error.message}`, 'error');
      setStaffLoaded(true);
    });
    return unsubscribe;
  }, [authReady, showToast]);

  useEffect(() => {
    if (!authReady || !db) return undefined;
    setDayLoaded(false);
    const dailyQuery = query(collection(db, 'queueStates'), where('date', '==', today));
    const unsubscribe = onSnapshot(dailyQuery, (snapshot) => {
      setDayStates(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setDayLoaded(true);
    }, (error) => {
      showToast(`โหลดคิวประจำวันไม่สำเร็จ: ${error.message}`, 'error');
      setDayLoaded(true);
    });
    return unsubscribe;
  }, [authReady, today, showToast]);

  useEffect(() => {
    if (!staffLoaded || !user) return;
    const currentStaff = staff.find((item) => item.id === user.id);
    if (!currentStaff || currentStaff.active === false) {
      localStorage.removeItem(STORAGE_KEY);
      setUser(null);
      setPage('queue');
      return;
    }
    if (currentStaff.name !== user.name) {
      const refreshed = { id: currentStaff.id, name: currentStaff.name };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
      setUser(refreshed);
    }
  }, [staff, staffLoaded, user]);

  const activeStaff = useMemo(() => staff.filter((item) => item.active !== false), [staff]);

  const login = (staffMember) => {
    const nextUser = { id: staffMember.id, name: staffMember.name };
    setStaff((existing) => existing.some((item) => item.id === staffMember.id) ? existing : [...existing, { ...staffMember, active: true }]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setPage('queue');
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setPage('queue');
  };

  const recordAction = async (type, queueNumber, status) => {
    if (!user) return;
    const label = queueLabel(type, queueNumber);
    const key = `${type}${queueNumber}`;
    setBusyKey(key);
    try {
      const stateRef = doc(db, 'queueStates', queueDocId(today, type, queueNumber));
      const eventRef = doc(collection(db, 'queueEvents'));
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(stateRef);
        if (existing.exists()) {
          throw new Error(`${label} ถูกดำเนินการไปแล้ว กรุณารีเฟรชรายการคิว`);
        }
        const record = {
          date: today,
          type,
          queueNumber,
          queue: label,
          status,
          score: status === 'checked' ? 1 : 0,
          staffId: user.id,
          staffName: user.name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        transaction.set(stateRef, record);
        transaction.set(eventRef, {
          ...record,
          eventType: status,
          eventAt: serverTimestamp()
        });
      });
      showToast(status === 'checked' ? `บันทึก ${label} สำเร็จ · +1 คะแนน` : `ยกเลิก ${label} สำเร็จ · ไม่คิดคะแนน`);
    } catch (error) {
      showToast(error.message || `บันทึก ${label} ไม่สำเร็จ`, 'error');
    } finally {
      setBusyKey('');
    }
  };

  const reopenQueue = async (record) => {
    if (!user) return;
    const confirmed = window.confirm(`ต้องการยกเลิกการบันทึก ${record.queue} และคืนคิวกลับไปหน้าหลักหรือไม่?`);
    if (!confirmed) return;
    setBusyKey(`undo-${record.id}`);
    try {
      const stateRef = doc(db, 'queueStates', record.id);
      const eventRef = doc(collection(db, 'queueEvents'));
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(stateRef);
        if (!snapshot.exists()) throw new Error('รายการนี้ถูกคืนคิวไปแล้ว');
        const current = snapshot.data();
        transaction.delete(stateRef);
        transaction.set(eventRef, {
          date: current.date,
          type: current.type,
          queueNumber: current.queueNumber,
          queue: current.queue,
          eventType: 'reopened',
          previousStatus: current.status,
          previousStaffId: current.staffId,
          previousStaffName: current.staffName,
          staffId: user.id,
          staffName: user.name,
          eventAt: serverTimestamp()
        });
      });
      showToast(`คืน ${record.queue} กลับหน้าหลักแล้ว`);
    } catch (error) {
      showToast(error.message || 'คืนคิวไม่สำเร็จ', 'error');
    } finally {
      setBusyKey('');
    }
  };

  if (!isFirebaseConfigured) return <ConfigurationScreen />;

  if (!authReady) {
    return <LoadingScreen label="กำลังเชื่อมต่อระบบ..." />;
  }

  if (authError) {
    return <ErrorScreen message={authError} />;
  }

  if (!user) {
    return (
      <LoginScreen
        staff={activeStaff}
        staffLoaded={staffLoaded}
        onLogin={login}
        onFirstStaffCreated={(item) => login(item)}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <ClipboardCheck size={21} />
            </div>
            <div className="min-w-0">
              <div className="font-extrabold tracking-wide text-slate-900">QUEUE CHECK</div>
              <div className="truncate text-xs text-slate-500">{page === 'queue' ? 'ระบบจัดการคิวประจำวัน' : 'ประวัติการดำเนินการ'}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden text-right sm:block">
              <div className="text-xs text-slate-500">เจ้าหน้าที่ที่เข้าสู่ระบบ</div>
              <div className="max-w-40 truncate text-sm font-semibold text-slate-800">{user.name}</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700 sm:hidden">
              {user.name.slice(0, 1)}
            </div>
            <button className="btn-muted !px-2.5 !py-2" onClick={logout} title="ออกจากระบบ">
              <LogOut size={16} /><span className="hidden sm:inline">ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-5 sm:py-6">
        {page === 'queue' ? (
          <QueuePage
            today={today}
            dayStates={dayStates}
            dayLoaded={dayLoaded}
            busyKey={busyKey}
            onAction={recordAction}
            user={user}
          />
        ) : (
          <HistoryPage
            today={today}
            staff={staff}
            currentUser={user}
            busyKey={busyKey}
            onReopen={reopenQueue}
            showToast={showToast}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-1 px-3 py-2">
          <button onClick={() => setPage('queue')} className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold transition ${page === 'queue' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
            <ListChecks size={20} /> หน้าหลัก / คิว
          </button>
          <button onClick={() => setPage('history')} className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold transition ${page === 'history' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
            <HistoryIcon size={20} /> ประวัติ
          </button>
        </div>
      </nav>

      {toast && (
        <div className={`fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.kind === 'error' ? 'bg-rose-600' : 'bg-slate-900'}`}>
          {toast.kind === 'error' ? <ShieldAlert size={17} /> : <Check size={17} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function LoginScreen({ staff, staffLoaded, onLogin, onFirstStaffCreated, showToast }) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const createFirstStaff = async (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const ref = await addDoc(collection(db, 'staff'), {
        name,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      onFirstStaffCreated({ id: ref.id, name });
    } catch (error) {
      showToast(`เพิ่มเจ้าหน้าที่ไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-sky-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
            <ClipboardCheck size={32} />
          </div>
          <h1 className="text-2xl font-extrabold tracking-wide text-slate-900">QUEUE CHECK</h1>
          <p className="mt-1 text-sm text-slate-500">เลือกชื่อเจ้าหน้าที่เพื่อเข้าสู่ระบบ</p>
        </div>

        <section className="panel p-5 sm:p-6">
          {!staffLoaded ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} /> กำลังโหลดรายชื่อเจ้าหน้าที่...</div>
          ) : staff.length > 0 ? (
            <>
              <label htmlFor="staff-login" className="mb-2 block text-sm font-semibold text-slate-700">ชื่อเจ้าหน้าที่</label>
              <div className="relative">
                <select
                  id="staff-login"
                  className="field appearance-none !py-3 pr-10 text-base"
                  defaultValue=""
                  onChange={(event) => {
                    const chosen = staff.find((item) => item.id === event.target.value);
                    if (chosen) onLogin(chosen);
                  }}
                >
                  <option value="" disabled>— เลือกชื่อเจ้าหน้าที่ —</option>
                  {staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">เมื่อเลือกชื่อ ระบบจะเข้าสู่หน้าหลักทันที</p>
            </>
          ) : (
            <form onSubmit={createFirstStaff} className="space-y-3">
              <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ยังไม่มีรายชื่อเจ้าหน้าที่ในระบบ กรุณาสร้างรายชื่อแรกเพื่อเริ่มใช้งาน</div>
              <label htmlFor="first-staff" className="block text-sm font-semibold text-slate-700">ชื่อเจ้าหน้าที่คนแรก</label>
              <input id="first-staff" className="field" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="เช่น นางสาว..." maxLength={80} required />
              <button className="btn-primary w-full" disabled={creating || !newName.trim()}>
                {creating ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />} เพิ่มชื่อและเข้าสู่ระบบ
              </button>
            </form>
          )}
        </section>
        <p className="mt-4 text-center text-xs text-slate-400">ข้อมูลคิวจะเริ่มรอบใหม่โดยอัตโนมัติตามวันที่ประเทศไทย</p>
      </div>
    </div>
  );
}

function QueuePage({ today, dayStates, dayLoaded, busyKey, onAction, user }) {
  const checkedCount = dayStates.filter((item) => item.status === 'checked').length;
  const canceledCount = dayStates.filter((item) => item.status === 'canceled').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700"><CalendarDays size={16} /> {formatThaiDate(today)}</div>
          <h2 className="mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">จัดการคิวประจำวัน</h2>
          <p className="mt-1 text-sm text-slate-500">ผู้ปฏิบัติงาน: <span className="font-semibold text-slate-700">{user.name}</span> · ระบบกำหนดวันที่ให้อัตโนมัติ</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-64">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
            <div className="text-xs text-emerald-700">Check วันนี้</div>
            <div className="text-xl font-extrabold tabular-nums text-emerald-800">{checkedCount}</div>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2">
            <div className="text-xs text-rose-700">ยกเลิกวันนี้</div>
            <div className="text-xl font-extrabold tabular-nums text-rose-800">{canceledCount}</div>
          </div>
        </div>
      </div>

      {!dayLoaded ? (
        <div className="panel flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} /> กำลังโหลดคิว...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
            <QueueColumn type="F" records={dayStates} busyKey={busyKey} onAction={onAction} />
            <QueueColumn type="A" records={dayStates} busyKey={busyKey} onAction={onAction} />
          </div>
          <SkippedQueues records={dayStates} busyKey={busyKey} onAction={onAction} />
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-500">
            <Clock3 className="mt-0.5 shrink-0 text-slate-400" size={15} />
            เมื่อดำเนินการคิวเลขที่สูงกว่า คิวก่อนหน้าที่ยังไม่ดำเนินการจะย้ายไปอยู่ในส่วน “คิวที่ข้าม” โดยอัตโนมัติ และจะไม่นับคะแนนจนกว่าจะกด Check
          </div>
        </>
      )}
    </div>
  );
}

function QueueColumn({ type, records, busyKey, onAction }) {
  const limit = QUEUE_LIMITS[type];
  const processed = new Set(records.filter((item) => item.type === type).map((item) => item.queueNumber));
  const maxProcessed = Math.max(0, ...processed);
  const normalQueues = [];
  for (let number = maxProcessed + 1; number <= limit; number += 1) {
    if (!processed.has(number)) normalQueues.push(number);
  }
  const accent = type === 'F'
    ? { header: 'bg-sky-600', soft: 'bg-sky-50', border: 'border-sky-100', text: 'text-sky-800' }
    : { header: 'bg-indigo-600', soft: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-800' };

  return (
    <section className="panel min-w-0 overflow-hidden">
      <div className={`${accent.header} flex items-center justify-between px-3 py-3 text-white sm:px-4`}>
        <div>
          <div className="text-lg font-extrabold">คิว {type}</div>
          <div className="text-[11px] text-white/80">{type}001–{type}{String(limit).padStart(3, '0')}</div>
        </div>
        <div className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold">รอ {normalQueues.length}</div>
      </div>
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 sm:px-4">{normalQueues.length ? `คิวถัดไป ${queueLabel(type, normalQueues[0])}` : 'ไม่มีคิวปกติที่รอดำเนินการ'}</div>
      <div className="max-h-[56vh] min-h-48 space-y-1.5 overflow-y-auto p-2 sm:max-h-[68vh] sm:p-3">
        {normalQueues.map((number) => {
          const label = queueLabel(type, number);
          const key = `${type}${number}`;
          const busy = busyKey === key;
          return (
            <div key={number} className={`flex items-center justify-between gap-1 rounded-lg border ${accent.border} ${accent.soft} px-2 py-2 sm:px-2.5`}>
              <span className={`min-w-0 font-bold tabular-nums ${accent.text} text-xs sm:text-sm`}>{label}</span>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => onAction(type, number, 'checked')} disabled={Boolean(busyKey)} className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-40 sm:h-8 sm:w-8" title={`Check ${label}`} aria-label={`Check ${label}`}>
                  {busy ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={15} strokeWidth={3} />}
                </button>
                <button onClick={() => window.confirm(`ยืนยันยกเลิก ${label} ใช่หรือไม่?`) && onAction(type, number, 'canceled')} disabled={Boolean(busyKey)} className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-100 text-rose-700 transition hover:bg-rose-200 disabled:opacity-40 sm:h-8 sm:w-8" title={`ยกเลิก ${label}`} aria-label={`ยกเลิก ${label}`}>
                  <X size={15} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SkippedQueues({ records, busyKey, onAction }) {
  const skipped = useMemo(() => {
    return ['F', 'A'].map((type) => {
      const processed = new Set(records.filter((item) => item.type === type).map((item) => item.queueNumber));
      const maxProcessed = Math.max(0, ...processed);
      const queues = [];
      for (let number = 1; number < maxProcessed; number += 1) {
        if (!processed.has(number)) queues.push({ type, number, queue: queueLabel(type, number) });
      }
      return { type, queues };
    });
  }, [records]);
  const total = skipped.reduce((sum, item) => sum + item.queues.length, 0);

  return (
    <section className="panel p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-slate-900"><ArrowDown className="text-amber-600" size={18} /> คิวที่ข้าม</h3>
          <p className="mt-0.5 text-xs text-slate-500">คิวที่ยังไม่ดำเนินการ แต่มีคิวเลขที่สูงกว่าผ่านไปแล้ว</p>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{total} คิว</span>
      </div>
      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm text-slate-400">ยังไม่มีคิวที่ถูกข้าม</div>
      ) : (
        <div className="space-y-3">
          {skipped.filter((group) => group.queues.length > 0).map((group) => (
            <div key={group.type}>
              <div className="mb-1.5 text-xs font-bold text-slate-500">คิว {group.type}</div>
              <div className="flex flex-wrap gap-2">
                {group.queues.map((item) => {
                  const key = `${item.type}${item.number}`;
                  const busy = busyKey === key;
                  return (
                    <div key={key} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 p-1 pl-2">
                      <span className="text-xs font-bold tabular-nums text-amber-900">{item.queue}</span>
                      <button onClick={() => onAction(item.type, item.number, 'checked')} disabled={Boolean(busyKey)} className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40" aria-label={`Check ${item.queue}`} title={`Check ${item.queue}`}>
                        {busy ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={14} strokeWidth={3} />}
                      </button>
                      <button onClick={() => window.confirm(`ยืนยันยกเลิก ${item.queue} ใช่หรือไม่?`) && onAction(item.type, item.number, 'canceled')} disabled={Boolean(busyKey)} className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-100 text-rose-700 hover:bg-rose-200 disabled:opacity-40" aria-label={`ยกเลิก ${item.queue}`} title={`ยกเลิก ${item.queue}`}>
                        <X size={14} strokeWidth={2.5} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryPage({ today, staff, currentUser, busyKey, onReopen, showToast }) {
  const [historyDate, setHistoryDate] = useState(today);
  const [historyStates, setHistoryStates] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(currentUser.id);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [monthlyStates, setMonthlyStates] = useState([]);
  const [monthlyLoaded, setMonthlyLoaded] = useState(false);

  useEffect(() => {
    setHistoryDate(today);
  }, [today]);

  useEffect(() => {
    if (!historyDate) return undefined;
    setHistoryLoaded(false);
    const historyQuery = query(collection(db, 'queueStates'), where('date', '==', historyDate));
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => sortQueueDescending(a, b));
      setHistoryStates(rows);
      setHistoryLoaded(true);
    }, (error) => {
      showToast(`โหลดประวัติไม่สำเร็จ: ${error.message}`, 'error');
      setHistoryLoaded(true);
    });
    return unsubscribe;
  }, [historyDate, showToast]);

  useEffect(() => {
    if (!month) return undefined;
    const [year, monthNumber] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const lastDay = new Date(year, monthNumber, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
    setMonthlyLoaded(false);
    const monthlyQuery = query(
      collection(db, 'queueStates'),
      where('date', '>=', monthStart),
      where('date', '<=', monthEnd)
    );
    const unsubscribe = onSnapshot(monthlyQuery, (snapshot) => {
      setMonthlyStates(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setMonthlyLoaded(true);
    }, (error) => {
      showToast(`โหลดสรุปรายเดือนไม่สำเร็จ: ${error.message}`, 'error');
      setMonthlyLoaded(true);
    });
    return unsubscribe;
  }, [month, showToast]);

  useEffect(() => {
    if (!staff.some((item) => item.id === selectedStaff && item.active !== false)) {
      const firstActive = staff.find((item) => item.active !== false);
      setSelectedStaff(firstActive?.id || '');
    }
  }, [staff, selectedStaff]);

  const selectedStaffRecords = useMemo(() => historyStates
    .filter((item) => item.staffId === selectedStaff && item.status === 'checked')
    .sort(sortQueueDescending), [historyStates, selectedStaff]);
  const selectedStaffCanceled = useMemo(() => historyStates
    .filter((item) => item.staffId === selectedStaff && item.status === 'canceled').length,
  [historyStates, selectedStaff]);

  const monthlySummary = useMemo(() => staff.map((member) => {
    const checked = monthlyStates.filter((item) => item.staffId === member.id && item.status === 'checked').length;
    const canceled = monthlyStates.filter((item) => item.staffId === member.id && item.status === 'canceled').length;
    return { ...member, checked, canceled };
  }), [staff, monthlyStates]);

  const fRecords = historyStates.filter((item) => item.type === 'F').sort(sortQueueDescending);
  const aRecords = historyStates.filter((item) => item.type === 'A').sort(sortQueueDescending);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700"><HistoryIcon size={17} /> HISTORY</div>
        <h2 className="mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">ประวัติการดำเนินการ</h2>
        <p className="mt-1 text-sm text-slate-500">ตรวจสอบรายการ Check และ Canceled รวมถึงคะแนนรายบุคคลและรายเดือน</p>
      </div>

      <section className="panel p-3 sm:p-4">
        <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-bold text-slate-900">3.1 ประวัติการเช็คคิวทั้งหมด</h3>
            <p className="text-xs text-slate-500">แยกคอลัมน์ F และ A เรียงคิวจากมากไปน้อย</p>
          </div>
          <div className="w-full sm:w-48">
            <label className="mb-1 block text-xs font-medium text-slate-500">เลือกวันที่ดูประวัติ</label>
            <input type="date" className="field" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
          </div>
        </div>
        {!historyLoaded ? <LoadingInline /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <HistoryQueueColumn type="F" rows={fRecords} busyKey={busyKey} onReopen={onReopen} />
            <HistoryQueueColumn type="A" rows={aRecords} busyKey={busyKey} onReopen={onReopen} />
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-400">* การคืนคิวจะนำรายการออกจากสถานะที่ดำเนินการแล้ว และบันทึกเหตุการณ์การคืนคิวไว้ในบันทึกระบบ</p>
      </section>

      <section className="panel p-3 sm:p-4">
        <div className="mb-3">
          <h3 className="font-bold text-slate-900">3.2 ประวัติการเช็คยารายบุคคล</h3>
          <p className="text-xs text-slate-500">เลือกเจ้าหน้าที่และวันที่ เพื่อดูคะแนนกับคิวที่ Check สำเร็จ</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">เจ้าหน้าที่</label>
            <select className="field" value={selectedStaff} onChange={(event) => setSelectedStaff(event.target.value)}>
              {staff.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">วันที่</label>
            <input type="date" className="field" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <div className="text-xs text-emerald-700">คะแนนวันนี้</div>
            <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-emerald-800">{historyLoaded ? selectedStaffRecords.length : '—'}</div>
            <div className="text-[11px] text-emerald-700">นับ Check = 1 คะแนน</div>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
            <div className="text-xs text-rose-700">ยกเลิกโดยเจ้าหน้าที่</div>
            <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-rose-800">{historyLoaded ? selectedStaffCanceled : '—'}</div>
            <div className="text-[11px] text-rose-700">ไม่นับคะแนน</div>
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
          <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <span>คิวที่ Check สำเร็จ · เรียงมากไปน้อย</span>
            <span>{historyLoaded ? `${selectedStaffRecords.length} คิว` : '...'}</span>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {!historyLoaded ? <LoadingInline /> : selectedStaffRecords.length === 0 ? <EmptyState text="ไม่มีคิวที่ Check สำเร็จในวันที่เลือก" /> : (
              <div className="flex flex-wrap gap-2">
                {selectedStaffRecords.map((record) => <span key={record.id} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold tabular-nums text-emerald-800">{record.queue}</span>)}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel p-3 sm:p-4">
        <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-bold text-slate-900">3.3 ประวัติการเช็คยารายเดือน</h3>
            <p className="text-xs text-slate-500">แสดงจำนวนคะแนนสะสมของเจ้าหน้าที่แต่ละคน</p>
          </div>
          <div className="w-full sm:w-48">
            <label className="mb-1 block text-xs font-medium text-slate-500">เลือกเดือน</label>
            <input type="month" className="field" value={month} onChange={(event) => setMonth(event.target.value)} />
          </div>
        </div>
        {!monthlyLoaded ? <LoadingInline /> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-3 font-semibold">เจ้าหน้าที่</th><th className="px-3 py-3 text-right font-semibold">คะแนน (Check)</th><th className="px-3 py-3 text-right font-semibold">Canceled</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlySummary.map((item) => (
                  <tr key={item.id} className="bg-white">
                    <td className="px-3 py-3 font-medium text-slate-800">{item.name}{item.active === false && <span className="ml-2 text-[10px] text-slate-400">(ปิดใช้งาน)</span>}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-emerald-700">{item.checked}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-rose-600">{item.canceled}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className="px-3 py-3">รวม</td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{monthlySummary.reduce((sum, item) => sum + item.checked, 0)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-600">{monthlySummary.reduce((sum, item) => sum + item.canceled, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <StaffManager staff={staff} currentUser={currentUser} showToast={showToast} />
    </div>
  );
}

function HistoryQueueColumn({ type, rows, busyKey, onReopen }) {
  const isF = type === 'F';
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className={`${isF ? 'bg-sky-600' : 'bg-indigo-600'} flex items-center justify-between px-3 py-2.5 text-white`}>
        <span className="font-bold">คิว {type}</span>
        <span className="text-xs text-white/80">{rows.length} รายการ</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? <EmptyState text="ไม่มีประวัติในวันที่เลือก" /> : (
          <div className="divide-y divide-slate-100">
            {rows.map((record) => (
              <div key={record.id} className="flex items-center justify-between gap-2 px-2.5 py-3 sm:px-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold tabular-nums text-slate-800">{record.queue}</span>
                    <StatusPill status={record.status} />
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">ผู้ดำเนินการ: {record.staffName || 'ไม่ระบุ'}</div>
                </div>
                <button onClick={() => onReopen(record)} disabled={Boolean(busyKey)} className="btn-muted shrink-0 !gap-1 !px-2 !py-2 text-xs" title="คืนคิวเพื่อแก้ไข">
                  {busyKey === `undo-${record.id}` ? <LoaderCircle className="animate-spin" size={13} /> : <RotateCcw size={13} />}<span className="hidden sm:inline">คืนคิว</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  if (status === 'checked') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Check</span>;
  return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">Canceled</span>;
}

function StaffManager({ staff, currentUser, showToast }) {
  const [newName, setNewName] = useState('');
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState('');
  const [adding, setAdding] = useState(false);

  const addStaff = async (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (staff.some((item) => item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showToast('มีชื่อเจ้าหน้าที่นี้อยู่แล้ว', 'error');
      return;
    }
    setAdding(true);
    try {
      await addDoc(collection(db, 'staff'), {
        name,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setNewName('');
      showToast('เพิ่มเจ้าหน้าที่เรียบร้อยแล้ว');
    } catch (error) {
      showToast(`เพิ่มชื่อไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setAdding(false);
    }
  };

  const saveStaff = async (member) => {
    const name = (drafts[member.id] ?? member.name).trim();
    if (!name) {
      showToast('กรุณาระบุชื่อเจ้าหน้าที่', 'error');
      return;
    }
    if (staff.some((item) => item.id !== member.id && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showToast('มีชื่อเจ้าหน้าที่นี้อยู่แล้ว', 'error');
      return;
    }
    setSavingId(member.id);
    try {
      await updateDoc(doc(db, 'staff', member.id), { name, updatedAt: serverTimestamp() });
      setDrafts((old) => ({ ...old, [member.id]: name }));
      showToast('แก้ไขชื่อเจ้าหน้าที่แล้ว');
    } catch (error) {
      showToast(`แก้ไขชื่อไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setSavingId('');
    }
  };

  const toggleActive = async (member) => {
    const next = member.active === false;
    if (!next && member.id === currentUser.id) {
      showToast('ไม่สามารถปิดใช้งานชื่อที่กำลังเข้าสู่ระบบอยู่ได้', 'error');
      return;
    }
    const actionText = next ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
    if (!window.confirm(`ต้องการ${actionText}เจ้าหน้าที่ ${member.name} หรือไม่?`)) return;
    setSavingId(member.id);
    try {
      await updateDoc(doc(db, 'staff', member.id), { active: next, updatedAt: serverTimestamp() });
      showToast(`${actionText}เจ้าหน้าที่เรียบร้อยแล้ว`);
    } catch (error) {
      showToast(`${actionText}ไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setSavingId('');
    }
  };

  return (
    <section className="panel p-3 sm:p-4">
      <div className="mb-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Users size={18} className="text-indigo-600" /> 4. จัดการเจ้าหน้าที่</h3>
        <p className="text-xs text-slate-500">เพิ่ม แก้ไขชื่อ และปิดใช้งานรายชื่อ โดยไม่ลบประวัติเดิม</p>
      </div>
      <form onSubmit={addStaff} className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="กรอกชื่อเจ้าหน้าที่ใหม่" maxLength={80} />
        <button className="btn-primary shrink-0" disabled={adding || !newName.trim()}>{adding ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />} เพิ่มเจ้าหน้าที่</button>
      </form>
      <div className="mt-3 divide-y divide-slate-100">
        {staff.map((member) => {
          const draft = drafts[member.id] ?? member.name;
          return (
            <div key={member.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <input className="field" value={draft} onChange={(event) => setDrafts((old) => ({ ...old, [member.id]: event.target.value }))} maxLength={80} />
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${member.active === false ? 'bg-slate-300' : 'bg-emerald-500'}`} />
                  {member.active === false ? 'ปิดใช้งาน' : 'ใช้งานอยู่'}
                  {member.id === currentUser.id && <span className="font-semibold text-indigo-600">· คุณกำลังใช้งาน</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => saveStaff(member)} disabled={savingId === member.id || !draft.trim() || draft === member.name} className="btn-muted flex-1 !py-2 sm:flex-none">
                  {savingId === member.id ? <LoaderCircle className="animate-spin" size={15} /> : 'บันทึกชื่อ'}
                </button>
                <button type="button" onClick={() => toggleActive(member)} disabled={savingId === member.id || member.id === currentUser.id} className={`btn flex-1 !py-2 sm:flex-none ${member.active === false ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {member.active === false ? 'เปิดใช้' : 'ปิดใช้'}
                </button>
              </div>
            </div>
          );
        })}
        {staff.length === 0 && <EmptyState text="ยังไม่มีรายชื่อเจ้าหน้าที่" />}
      </div>
    </section>
  );
}

function LoadingInline() {
  return <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={17} /> กำลังโหลดข้อมูล...</div>;
}

function EmptyState({ text }) {
  return <div className="px-3 py-8 text-center text-sm text-slate-400">{text}</div>;
}

function LoadingScreen({ label }) {
  return <div className="flex min-h-screen items-center justify-center gap-3 bg-slate-50 text-sm text-slate-500"><LoaderCircle className="animate-spin text-indigo-600" size={22} /> {label}</div>;
}

function ErrorScreen({ message }) {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="panel max-w-lg p-6"><ShieldAlert className="mb-3 text-rose-600" size={28} /><h1 className="font-bold text-slate-900">เชื่อมต่อระบบไม่สำเร็จ</h1><p className="mt-2 break-words text-sm text-slate-600">{message}</p><p className="mt-3 text-xs text-slate-500">ตรวจสอบว่าเปิดใช้ Anonymous Authentication ใน Firebase แล้ว</p></div></div>;
}

function ConfigurationScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="panel max-w-xl p-6">
        <ShieldAlert className="mb-3 text-amber-600" size={30} />
        <h1 className="text-lg font-bold text-slate-900">ยังไม่ได้ตั้งค่า Firebase</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">สร้างไฟล์ <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.local</code> จาก <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.example</code> แล้วกรอกค่าการเชื่อมต่อ Firebase จาก Project settings</p>
        <p className="mt-3 text-xs text-slate-500">ดูขั้นตอนอย่างละเอียดได้ในไฟล์ README_TH.md ที่แนบมากับโปรเจกต์</p>
      </div>
    </div>
  );
}

export default App;
