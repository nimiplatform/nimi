import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ReactNode } from 'react';

export type CanonicalDrawerShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  widthClassName?: string;
  children: ReactNode;
};

export function CanonicalDrawerShell({
  open,
  onClose,
  title,
  subtitle = null,
  widthClassName = 'w-[360px] max-w-[92vw]',
  children,
}: CanonicalDrawerShellProps) {
  return (
    <div
      className={cn(
        'absolute inset-y-0 right-0 z-30 border-l border-white/70 bg-[#f8fbfb] shadow-[-8px_0_24px_rgba(15,23,42,0.08)] transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]',
        widthClassName,
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            {subtitle ? (
              <p className="text-[11px] text-gray-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50"
            aria-label={`Close ${title}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" style={{ willChange: 'transform' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
