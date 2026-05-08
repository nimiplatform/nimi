import { IconButton, SidebarShell, cn } from '@nimiplatform/nimi-kit/ui';
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
    <SidebarShell
      as="div"
      className={cn(
        'absolute inset-y-0 right-0 z-30 rounded-none border-y-0 border-r-0 bg-[#f8fbfb] shadow-[-8px_0_24px_rgba(15,23,42,0.08)] transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]',
        widthClassName,
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
      aria-hidden={!open}
      data-canonical-drawer-shell="true"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4" data-canonical-drawer-header="true">
          <div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            {subtitle ? (
              <p className="text-[11px] text-gray-500">{subtitle}</p>
            ) : null}
          </div>
          <IconButton
            onClick={onClose}
            className="h-8 w-8 rounded-full border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            aria-label={`Close ${title}`}
            icon={(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" style={{ willChange: 'transform' }} data-canonical-drawer-scroll="true">
          {children}
        </div>
      </div>
    </SidebarShell>
  );
}
