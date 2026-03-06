import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  addToast: (opts: { type: ToastType; message: string; duration?: number }) => void;
}

// ─── Context ────────────────────────────────────────────────────────
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

// ─── Toast styling by type ──────────────────────────────────────────
const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: typeof CheckCircle }> = {
  success: { bg: 'bg-green-50', border: 'border-green-300', icon: CheckCircle },
  error:   { bg: 'bg-red-50',   border: 'border-red-300',   icon: AlertCircle },
  warning: { bg: 'bg-amber-50', border: 'border-amber-300', icon: AlertTriangle },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-300',  icon: Info },
};

const ICON_COLORS: Record<ToastType, string> = {
  success: 'text-green-600',
  error:   'text-red-600',
  warning: 'text-amber-600',
  info:    'text-blue-600',
};

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 5000,
  error:   8000,
  warning: 6000,
  info:    5000,
};

// ─── Individual Toast Component ─────────────────────────────────────
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { bg, border, icon: Icon } = TOAST_STYLES[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className={`${bg} ${border} border rounded-lg shadow-lg px-4 py-3 flex items-start gap-3 max-w-sm animate-[slideIn_0.3s_ease-out] pointer-events-auto`}
    >
      <Icon size={18} className={`${ICON_COLORS[toast.type]} shrink-0 mt-0.5`} />
      <p className="text-sm text-gray-800 flex-1">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-gray-400 hover:text-gray-600 shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Provider ───────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback(({ type, message, duration }: { type: ToastType; message: string; duration?: number }) => {
    const id = `toast-${++counterRef.current}`;
    setToasts(prev => [...prev, { id, type, message, duration: duration ?? DEFAULT_DURATION[type] }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext value={{ addToast }}>
      {children}

      {/* Toast stack — fixed bottom-right */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map(toast => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>
      )}
    </ToastContext>
  );
}
