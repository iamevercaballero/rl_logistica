import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastInput = {
  kind?: ToastKind;
  title?: string;
  message: string;
  duration?: number; // ms; 0 = no auto-dismiss
  action?: ToastAction;
};

type ToastRecord = ToastInput & {
  id: number;
  kind: ToastKind;
  duration: number;
};

type ToastContextValue = {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  toast: {
    success: (msg: string, opts?: Omit<ToastInput, 'message' | 'kind'>) => number;
    error: (msg: string, opts?: Omit<ToastInput, 'message' | 'kind'>) => number;
    warning: (msg: string, opts?: Omit<ToastInput, 'message' | 'kind'>) => number;
    info: (msg: string, opts?: Omit<ToastInput, 'message' | 'kind'>) => number;
  };
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3000,
  info: 3500,
  warning: 5000,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idSeq = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput): number => {
    const id = idSeq.current++;
    const kind = input.kind ?? 'info';
    const duration = input.duration ?? DEFAULT_DURATION[kind];
    setToasts((prev) => [...prev, { ...input, id, kind, duration }]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      toast: {
        success: (msg, opts) => push({ ...opts, message: msg, kind: 'success' }),
        error: (msg, opts) => push({ ...opts, message: msg, kind: 'error' }),
        warning: (msg, opts) => push({ ...opts, message: msg, kind: 'warning' }),
        info: (msg, opts) => push({ ...opts, message: msg, kind: 'info' }),
      },
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="toast-viewport" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const handle = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(handle);
  }, [toast.id, toast.duration, onDismiss]);

  const role = toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status';

  return (
    <div className={`toast toast--${toast.kind}`} role={role}>
      <div className="toast__icon" aria-hidden="true">
        {iconFor(toast.kind)}
      </div>
      <div className="toast__body">
        {toast.title ? <div className="toast__title">{toast.title}</div> : null}
        <div className="toast__message">{toast.message}</div>
        {toast.action ? (
          <button
            type="button"
            className="toast__action"
            onClick={() => {
              toast.action!.onClick();
              onDismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="toast__close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar notificación"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function iconFor(kind: ToastKind) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'success':
      return (
        <svg {...common}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'error':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case 'warning':
      return (
        <svg {...common}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'info':
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}
