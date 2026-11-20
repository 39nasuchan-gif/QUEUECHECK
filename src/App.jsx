import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, CalendarDays, Check, ChevronDown,
  ClipboardCheck, LogOut, Plus, RotateCcw, ShieldAlert,
  Users, X, Trash2, History as HistoryIcon, ListChecks, LoaderCircle
} from 'lucide-react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query, runTransaction,
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
  return type === 'U' ? 'คิวด่วน' : `${type}${String(number).padStart(3, '0')}`;
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
    <div className="min-h-screen bg-slate-50 pb-24 glass-app">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur glass-header">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm glass-logo">
              <ClipboardCheck size={21} />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                <div className="shrink-0 font-extrabold tracking-wide text-slate-900">QUEUE CHECK</div>
                {page === 'queue' ? (
                  <>
                    <div className="text-xs font-semibold text-sky-700"><CalendarDays size={13} className="mr-1 inline" />{formatThaiDate(today)}</div>
                    <div className="max-w-32 truncate text-xs font-semibold text-slate-600 sm:max-w-none">{user.name}</div>
                  </>
                ) : <div className="text-xs text-slate-500">ประวัติการดำเนินการ</div>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden text-right sm:block">
              <div className="text-xs text-slate-500">เจ้าหน้าที่ที่เข้าสู่ระบบ</div>
              <div className="max-w-40 truncate text-sm font-semibold text-slate-800">{user.name}</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700 sm:hidden glass-user-avatar">
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

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur glass-nav">
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-1 px-3 py-2">
          <button onClick={() => setPage('queue')} className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold transition ${page === 'queue' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
            <ListChecks size={20} /> หน้าหลัก
          </button>
          <button onClick={() => setPage('history')} className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold transition ${page === 'history' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
            <HistoryIcon size={20} /> ประวัติ
          </button>
        </div>
      </nav>

      {toast && (
        <div className={`glass-toast fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.kind === 'error' ? 'bg-rose-600' : 'bg-slate-900'}`}>
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-sky-50 px-4 py-10 sky-login-screen">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200 glass-login-logo">
            <ClipboardCheck size={32} />
          </div>
          <h1 className="text-2xl font-extrabold tracking-wide text-slate-900">QUEUE CHECK</h1>
          <p className="mt-1 text-sm text-slate-500">เลือกชื่อเจ้าหน้าที่เพื่อเข้าสู่ระบบ</p>
        </div>

        <section className="panel glass-panel p-5 sm:p-6">
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
  const checkedF = dayStates.filter((item) => item.type === 'F' && item.status === 'checked').length;
  const checkedA = dayStates.filter((item) => item.type === 'A' && item.status === 'checked').length;
  const canceledRecords = dayStates.filter((item) => item.status === 'canceled').sort(sortQueueDescending);

  return (
    <div className="queue-dashboard-grid">
      {!dayLoaded ? (
        <div className="panel glass-panel flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} /> กำลังโหลดคิว...</div>
      ) : (
        <>
          <UrgentQueueCard records={dayStates} busyKey={busyKey} onAction={onAction} />
          <SkippedQueues records={dayStates} busyKey={busyKey} onAction={onAction} />
          <div className="queue-pair-section mx-auto grid w-full grid-cols-2 items-stretch gap-2 sm:gap-3">
            <QueueColumn type="F" records={dayStates} busyKey={busyKey} onAction={onAction} />
            <QueueColumn type="A" records={dayStates} busyKey={busyKey} onAction={onAction} />
          </div>
          <CanceledQueues records={canceledRecords} />
          <div className="queue-stats-strip mx-auto grid w-full grid-cols-3 gap-2">
            <DailyStat label="เช็ค F วันนี้" value={checkedF} tone="success" />
            <DailyStat label="เช็ค A วันนี้" value={checkedA} tone="success" />
            <DailyStat label="ยกเลิกวันนี้" value={canceledRecords.length} tone="danger" />
          </div>
        </>
      )}
    </div>
  );
}

function DailyStat({ label, value, tone }) {
  const success = tone === 'success';
  return (
    <div className={`min-w-0 rounded-2xl border px-2.5 py-3 sm:px-4 glass-stat ${success ? 'glass-stat-success border-emerald-100' : 'glass-stat-danger border-rose-100'}`}>
      <div className={`text-[11px] font-semibold sm:text-sm ${success ? 'text-emerald-700' : 'text-rose-700'}`}>{label}</div>
      <div className={`mt-0.5 text-xl font-extrabold tabular-nums sm:text-2xl ${success ? 'text-emerald-800' : 'text-rose-800'}`}>{value}</div>
    </div>
  );
}

function UrgentQueueCard({ records, busyKey, onAction }) {
  const done = records.some((item) => item.type === 'U' && item.status === 'checked');
  const busy = busyKey === 'U1';
  return (
    <section className="urgent-queue-bar flex items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <div className="text-base font-extrabold text-sky-950 sm:text-lg">คิวด่วน</div>
        <div className="text-xs text-sky-700">{done ? 'ดำเนินการแล้ววันนี้' : 'เช็คคิวด่วน · นับ 1 คะแนน'}</div>
      </div>
      <button
        type="button"
        onClick={() => onAction('U', 1, 'checked')}
        disabled={Boolean(busyKey) || done}
        className="urgent-check-button inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border px-5 py-2 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={16} strokeWidth={3} />}
        {done ? 'เช็คแล้ว' : 'เช็ค'}
      </button>
    </section>
  );
}

function QueueActionCard({ type, number, busyKey, onAction, compact = false }) {
  const label = queueLabel(type, number);
  const key = `${type}${number}`;
  const busy = busyKey === key;
  const accent = type === 'F'
    ? { border: 'border-sky-200', number: 'text-sky-950' }
    : { border: 'border-indigo-200', number: 'text-indigo-950' };

  return (
    <article className={`min-w-0 rounded-[24px] border-[3px] ${accent.border} bg-white px-2 py-2 shadow-sm transition-shadow hover:shadow-md glass-queue-card ${compact ? 'sm:px-3 sm:py-2.5' : 'px-2.5 py-2.5 sm:px-3 sm:py-3'}`}>
      <div className={`mb-2 text-center font-extrabold tracking-wide tabular-nums leading-tight ${accent.number} ${compact ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}`}>{label}</div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => onAction(type, number, 'checked')}
          disabled={Boolean(busyKey)}
          className="flex min-h-10 items-center justify-center gap-1 rounded-full border-[3px] border-slate-500 bg-[#83dc55] px-1.5 text-xs font-bold text-slate-900 transition hover:bg-[#70cf43] active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-11 sm:text-sm glass-action-check"
          title={`Check ${label}`}
          aria-label={`Check ${label}`}
        >
          {busy ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} strokeWidth={3} />}
          เช็ค
        </button>
        <button
          type="button"
          onClick={() => onAction(type, number, 'canceled')}
          disabled={Boolean(busyKey)}
          className="flex min-h-8 items-center justify-center gap-1 rounded-full border-2 border-rose-300 bg-[#ff3434] px-2 text-[10px] font-bold text-slate-950 transition hover:bg-[#ee2525] active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9 sm:px-2.5 sm:text-xs glass-action-cancel"
          title={`ยกเลิก ${label}`}
          aria-label={`ยกเลิก ${label}`}
        >
          <X size={14} strokeWidth={2.8} /> ยกเลิก
        </button>
      </div>
    </article>
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
  const isF = type === 'F';

  return (
    <section className="queue-scroll-panel min-w-0 flex flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm glass-queue-column">
      <div className={`px-2 py-2 text-center text-sm font-extrabold glass-queue-column-heading ${isF ? 'bg-sky-50 text-sky-800' : 'bg-indigo-50 text-indigo-800'}`}>
        คิว {type}
      </div>
      <div className="queue-scroll-content min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2 sm:space-y-2.5 sm:p-3">
        {normalQueues.map((number) => (
          <QueueActionCard key={number} type={type} number={number} busyKey={busyKey} onAction={onAction} />
        ))}
        {normalQueues.length === 0 && <EmptyState text="ดำเนินการครบแล้ว" />}
      </div>
    </section>
  );
}

function SkippedQueues({ records, busyKey, onAction }) {
  const skipped = useMemo(() => ['F', 'A'].map((type) => {
    const processed = new Set(records.filter((item) => item.type === type).map((item) => item.queueNumber));
    const maxProcessed = Math.max(0, ...processed);
    const queues = [];
    for (let number = 1; number < maxProcessed; number += 1) {
      if (!processed.has(number)) queues.push(number);
    }
    return { type, queues };
  }), [records]);
  const total = skipped.reduce((sum, item) => sum + item.queues.length, 0);

  return (
    <section className="queue-scroll-panel glass-section glass-section-skipped min-h-0 overflow-hidden rounded-2xl border-2 border-slate-300 bg-white px-2.5 py-2 shadow-sm sm:px-4 sm:py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900 sm:text-lg">
          <ArrowDown className="text-amber-600" size={25} /> คิวที่ข้าม
        </h3>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">{total} คิว</span>
      </div>
      <p className="mt-0.5 text-[10px] leading-tight text-slate-500 sm:text-xs">คิวที่ยังไม่ดำเนินการ แต่มีคิวเลขที่สูงกว่าผ่านไปแล้ว</p>
      {total === 0 ? (
        <div className="mt-3 flex min-h-14 items-center rounded-xl bg-slate-50 px-3 text-sm text-slate-400">วันนี้ยังไม่มีคิวที่ถูกข้าม</div>
      ) : (
        <div className="queue-pair-scroll mt-1.5 grid min-h-0 grid-cols-2 items-stretch gap-2 sm:gap-3">
          {skipped.map((group) => {
            const isF = group.type === 'F';
            return (
              <div key={group.type} className={`queue-scroll-panel min-w-0 flex flex-col overflow-hidden rounded-xl border p-1.5 sm:p-2 ${isF ? 'border-sky-200 bg-sky-50/55' : 'border-indigo-200 bg-indigo-50/55'}`}>
                <div className={`mb-2 flex items-center justify-between gap-1 text-sm font-extrabold ${isF ? 'text-sky-800' : 'text-indigo-800'}`}>
                  <span>คิว {group.type}</span>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px]">{group.queues.length}</span>
                </div>
                {/* F and A stay in parallel columns, matching the main queue columns. */}
                <div className="queue-scroll-content min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain">
                  {group.queues.length === 0 ? (
                    <div className="rounded-lg bg-white/70 px-1 py-2 text-center text-[10px] text-slate-400">ไม่มีคิวที่ข้าม</div>
                  ) : group.queues.map((number) => (
                    <QueueActionCard key={`${group.type}${number}`} type={group.type} number={number} busyKey={busyKey} onAction={onAction} compact />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CanceledQueues({ records }) {
  return (
    <div className="queue-pair-section grid min-h-0 grid-cols-2 gap-2 sm:gap-3">
      {['F', 'A'].map((type) => {
        const rows = records.filter((record) => record.type === type).sort(sortQueueDescending);
        const isF = type === 'F';
        return (
          <section key={type} className={`queue-scroll-panel min-w-0 flex flex-col overflow-hidden rounded-xl border p-2 shadow-sm glass-canceled-column ${isF ? 'glass-canceled-f' : 'glass-canceled-a'}`}>
            <div className="flex items-center justify-between gap-1">
              <h3 className={`text-sm font-extrabold sm:text-base ${isF ? 'text-sky-900' : 'text-indigo-900'}`}>คิว {type} ยกเลิก</h3>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">{rows.length}</span>
            </div>
            <div className="queue-scroll-content min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
              {rows.length === 0 ? <EmptyState text="ไม่มีคิวที่ยกเลิก" /> : rows.map((record) => (
                <div key={record.id} className="rounded-xl border border-rose-200/80 bg-white/75 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-extrabold tabular-nums text-slate-800">{record.queue}</span>
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-bold text-rose-700">ยกเลิก</span>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-slate-500">ยกเลิกโดย {record.staffName || 'ไม่ระบุชื่อ'}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
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

  const selectedStaffRecords = useMemo(() => historyStates
    .filter((item) => item.staffId === selectedStaff && item.status === 'checked')
    .sort(sortQueueDescending), [historyStates, selectedStaff]);
  const selectedStaffCanceled = useMemo(() => historyStates
    .filter((item) => item.staffId === selectedStaff && item.status === 'canceled').length,
  [historyStates, selectedStaff]);

  const monthlySummary = useMemo(() => {
    const summary = new Map(staff.map((member) => [member.id, { id: member.id, name: member.name, checked: 0, canceled: 0 }]));
    monthlyStates.forEach((record) => {
      if (!record.staffId) return;
      if (!summary.has(record.staffId)) {
        summary.set(record.staffId, { id: record.staffId, name: record.staffName || 'เจ้าหน้าที่ที่ถูกลบ', checked: 0, canceled: 0 });
      }
      const entry = summary.get(record.staffId);
      if (record.status === 'checked') entry.checked += 1;
      if (record.status === 'canceled') entry.canceled += 1;
    });
    return [...summary.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
  }, [staff, monthlyStates]);

  const fRecords = historyStates.filter((item) => item.type === 'F').sort(sortQueueDescending);
  const aRecords = historyStates.filter((item) => item.type === 'A').sort(sortQueueDescending);
  const urgentRecords = historyStates.filter((item) => item.type === 'U');
  const canceledHistory = historyStates.filter((item) => item.status === 'canceled').sort((a, b) => {
    const typeOrder = String(a.type).localeCompare(String(b.type));
    return typeOrder || sortQueueDescending(a, b);
  });
  const historyStaffOptions = useMemo(() => {
    const options = new Map(staff.filter((item) => item.active !== false).map((item) => [item.id, { id: item.id, name: item.name }]));
    historyStates.forEach((item) => {
      if (item.staffId && !options.has(item.staffId)) {
        options.set(item.staffId, { id: item.staffId, name: item.staffName || 'เจ้าหน้าที่ที่ถูกลบ' });
      }
    });
    return [...options.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
  }, [staff, historyStates]);

  useEffect(() => {
    if (selectedStaff && !historyStaffOptions.some((item) => item.id === selectedStaff)) {
      setSelectedStaff(historyStaffOptions[0]?.id || '');
    }
  }, [historyStaffOptions, selectedStaff]);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700"><HistoryIcon size={17} /> HISTORY</div>
        <h2 className="mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">ประวัติการดำเนินการ</h2>
        <p className="mt-1 text-sm text-slate-500">ตรวจสอบรายการ Check และ Canceled รวมถึงคะแนนรายบุคคลและรายเดือน</p>
      </div>

      <section className="panel glass-panel p-3 sm:p-4">
        <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-bold text-slate-900">ประวัติการเช็คคิวทั้งหมด</h3>
            <p className="text-xs text-slate-500">แยกคอลัมน์ F และ A เรียงคิวจากมากไปน้อย</p>
          </div>
          <div className="w-full sm:w-48">
            <label className="mb-1 block text-xs font-medium text-slate-500">เลือกวันที่ดูประวัติ</label>
            <input type="date" className="field" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
          </div>
        </div>
        {!historyLoaded ? <LoadingInline /> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <HistoryQueueColumn type="F" rows={fRecords} busyKey={busyKey} onReopen={onReopen} />
              <HistoryQueueColumn type="A" rows={aRecords} busyKey={busyKey} onReopen={onReopen} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <HistoryQueueColumn type="U" rows={urgentRecords} busyKey={busyKey} onReopen={onReopen} />
              <HistoryCanceledColumn rows={canceledHistory} />
            </div>
          </>
        )}
        <p className="mt-3 text-[11px] text-slate-400">* การคืนคิวจะนำรายการออกจากสถานะที่ดำเนินการแล้ว และบันทึกเหตุการณ์การคืนคิวไว้ในบันทึกระบบ</p>
      </section>

      <section className="panel glass-panel p-3 sm:p-4">
        <div className="mb-3">
          <h3 className="font-bold text-slate-900">ประวัติการเช็คยารายบุคคล</h3>
          <p className="text-xs text-slate-500">เลือกเจ้าหน้าที่และวันที่ เพื่อดูคะแนนกับคิวที่ Check สำเร็จ</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">เจ้าหน้าที่</label>
            <select className="field" value={selectedStaff} onChange={(event) => setSelectedStaff(event.target.value)}>
              {historyStaffOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">วันที่</label>
            <input type="date" className="field" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 glass-stat glass-stat-success">
            <div className="text-xs text-emerald-700">คะแนนวันนี้</div>
            <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-emerald-800">{historyLoaded ? selectedStaffRecords.length : '—'}</div>
            <div className="text-[11px] text-emerald-700">นับ Check = 1 คะแนน</div>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50 p-3 glass-stat glass-stat-danger">
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

      <section className="panel glass-panel p-3 sm:p-4">
        <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-bold text-slate-900">ประวัติการเช็คยารายเดือน</h3>
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
                    <td className="px-3 py-3 font-medium text-slate-800">{item.name}</td>
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
    <div className="overflow-hidden rounded-xl border border-slate-200 glass-history-column">
      <div className={`${isF ? 'bg-sky-600' : 'bg-indigo-600'} flex items-center justify-between px-3 py-2.5 text-white glass-history-column-heading`}>
        <span className="font-bold">{type === 'U' ? 'คิวด่วน' : `คิว ${type}`}</span>
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

function HistoryCanceledColumn({ rows }) {
  return (
    <div className="overflow-hidden rounded-xl border border-rose-200 glass-history-column">
      <div className="flex items-center justify-between bg-rose-500 px-3 py-2.5 text-white">
        <span className="font-bold">คิวยกเลิก</span>
        <span className="text-xs text-white/85">{rows.length} รายการ</span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {rows.length === 0 ? <EmptyState text="ไม่มีรายการยกเลิกในวันที่เลือก" /> : (
          <div className="divide-y divide-rose-100">
            {rows.map((record) => (
              <div key={record.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-bold text-slate-800">{record.queue || queueLabel(record.type, record.queueNumber)}</div>
                  <div className="truncate text-xs text-slate-500">ยกเลิกโดย {record.staffName || 'ไม่ระบุชื่อ'}</div>
                </div>
                <StatusPill status="canceled" />
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

  const deleteStaff = async (member) => {
    if (member.id === currentUser.id) {
      showToast('ไม่สามารถลบชื่อที่กำลังเข้าสู่ระบบอยู่ได้ กรุณาเข้าสู่ระบบด้วยชื่ออื่นก่อน', 'error');
      return;
    }
    const confirmed = window.confirm(
      `ต้องการลบชื่อเจ้าหน้าที่ “${member.name}” อย่างถาวรหรือไม่?\n\nชื่อจะถูกนำออกจากรายการเข้าสู่ระบบ แต่ประวัติคิวเดิมจะยังเก็บชื่อผู้บันทึกไว้`
    );
    if (!confirmed) return;
    setSavingId(member.id);
    try {
      await deleteDoc(doc(db, 'staff', member.id));
      setDrafts((old) => {
        const next = { ...old };
        delete next[member.id];
        return next;
      });
      showToast('ลบชื่อเจ้าหน้าที่ถาวรแล้ว โดยประวัติเดิมยังคงอยู่');
    } catch (error) {
      showToast(`ลบชื่อไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      setSavingId('');
    }
  };

  return (
    <section className="panel glass-panel p-3 sm:p-4">
      <div className="mb-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Users size={18} className="text-indigo-600" /> จัดการเจ้าหน้าที่</h3>
        <p className="text-xs text-slate-500">เพิ่ม แก้ไขชื่อ หรือลบรายชื่อถาวร ประวัติคิวเดิมจะไม่ถูกลบตาม</p>
      </div>
      <form onSubmit={addStaff} className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="กรอกชื่อเจ้าหน้าที่ใหม่" maxLength={80} />
        <button className="btn-primary shrink-0" disabled={adding || !newName.trim()}>{adding ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />} เพิ่มเจ้าหน้าที่</button>
      </form>
      <div className="mt-3 divide-y divide-slate-100">
        {staff.map((member) => {
          const draft = drafts[member.id] ?? member.name;
          const isCurrentUser = member.id === currentUser.id;
          return (
            <div key={member.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <input className="field" value={draft} onChange={(event) => setDrafts((old) => ({ ...old, [member.id]: event.target.value }))} maxLength={80} />
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${member.active === false ? 'bg-slate-300' : 'bg-emerald-500'}`} />
                  {member.active === false ? 'รายชื่อเดิมที่ถูกปิดใช้งาน' : 'มีสิทธิ์ปรากฏในรายการเข้าสู่ระบบ'}
                  {isCurrentUser && <span className="font-semibold text-indigo-600">· คุณกำลังใช้งาน</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => saveStaff(member)} disabled={savingId === member.id || !draft.trim() || draft === member.name} className="btn-muted flex-1 !py-2 sm:flex-none">
                  {savingId === member.id ? <LoaderCircle className="animate-spin" size={15} /> : 'บันทึกชื่อ'}
                </button>
                <button type="button" onClick={() => deleteStaff(member)} disabled={savingId === member.id || isCurrentUser} className="btn flex-1 !py-2 sm:flex-none bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40" title={isCurrentUser ? 'เข้าสู่ระบบด้วยชื่ออื่นก่อนจึงจะลบชื่อนี้ได้' : 'ลบชื่อเจ้าหน้าที่ถาวร'}>
                  {savingId === member.id ? <LoaderCircle className="animate-spin" size={15} /> : <><Trash2 size={15} /> ลบถาวร</>}
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
