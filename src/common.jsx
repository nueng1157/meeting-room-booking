import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react';
import { explain } from './api';
import { statuses } from './domain';

export function Field({ label, children, wide = false }) {
  const id = useId();
  return <div className={'field ' + (wide ? 'sm:col-span-2' : '')}>
    <label htmlFor={id}>{label}</label>{cloneElement(children, { id })}
  </div>;
}

export function Message({ children, type = 'error' }) {
  if (!children) return null;
  return <p className={'notice ' + type} role={type === 'error' ? 'alert' : 'status'}>
    <AlertCircle size={18} /> <span>{children}</span>
  </p>;
}

export function Status({ value }) {
  return <span className={'status ' + value}><i />{statuses[value]}</span>;
}

export function Empty({ children }) {
  return <div className="empty"><CalendarDays size={26} />{children}</div>;
}

export function Loading() {
  return <div className="empty" role="status"><LoaderCircle size={25} className="animate-spin" />กำลังโหลดข้อมูล…</div>;
}

export function PageTitle({ title, subtitle, children }) {
  return <div className="page-heading">
    <div><h1>{title}</h1><p>{subtitle}</p></div>
    {children}
  </div>;
}

export function Pager({ page, hasNext, onChange, busy }) {
  return <div className="pager">
    <button className="btn secondary" disabled={page === 0 || busy} onClick={() => onChange(page - 1)}
      aria-label="หน้าก่อน"><ChevronLeft size={17} /> ก่อนหน้า</button>
    <span>หน้า {page + 1}</span>
    <button className="btn secondary" disabled={!hasNext || busy} onClick={() => onChange(page + 1)}
      aria-label="หน้าถัดไป">ถัดไป <ChevronRight size={17} /></button>
  </div>;
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="icon-btn" aria-label="ปิด" onClick={onClose}><X size={20} /></button>
    </div>
    {children}
  </dialog>;
}

export function useLoad(key, load, keepData = false) {
  const [state, set] = useState({ key: null, data: null, error: null });
  const latest = useRef(load);
  useEffect(() => { latest.current = load; });
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => latest.current()).then(
      (data) => { if (active) set({ key, data, error: null }); },
      (error) => { if (active) set({ key, data: null, error: explain(error) }); },
    );
    return () => { active = false; };
  }, [key]);
  return state.key === key ? { ...state, loading: false }
    : { data: keepData ? state.data : null, error: null, loading: true };
}
