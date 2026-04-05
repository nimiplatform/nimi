import React, { useEffect, useState, type ReactNode } from 'react';

type SidebarBoundaryProps = {
  children: ReactNode;
  resetKey: string;
  title: string;
  body: string;
  closeLabel: string;
  onClose: () => void;
};

type SidebarBoundaryState = {
  error: Error | null;
};

const DEFAULT_WIDTH_PX = 320;
const DEFAULT_PREWARM_DELAY_MS = 700;

class CanonicalRightSidebarBoundary extends React.Component<SidebarBoundaryProps, SidebarBoundaryState> {
  override state: SidebarBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): SidebarBoundaryState {
    return { error };
  }

  override componentDidUpdate(prevProps: SidebarBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex h-full flex-col justify-between border-l border-white/70 bg-[#f7fafb] p-4">
        <div className="rounded-[24px] border border-rose-200 bg-white px-4 py-4 shadow-[0_14px_28px_rgba(15,23,42,0.08)]">
          <p className="text-base font-semibold text-rose-700">{this.props.title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{this.props.body}</p>
          <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {String(this.state.error.message || this.state.error.name || 'right sidebar error')}
          </p>
        </div>
        <button
          type="button"
          onClick={this.props.onClose}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          {this.props.closeLabel}
        </button>
      </div>
    );
  }
}

export type CanonicalRightSidebarProps = {
  open: boolean;
  content: ReactNode;
  onClose: () => void;
  overlayMenu?: ReactNode;
  prewarm?: boolean;
  prewarmDelayMs?: number;
  widthPx?: number;
  resetKey?: string;
  fallbackTitle?: string;
  fallbackBody?: string;
  closeLabel?: string;
};

export function CanonicalRightSidebar({
  open,
  content,
  onClose,
  overlayMenu = null,
  prewarm = true,
  prewarmDelayMs = DEFAULT_PREWARM_DELAY_MS,
  widthPx = DEFAULT_WIDTH_PX,
  resetKey = 'canonical-right-sidebar',
  fallbackTitle = 'Inspect panel crashed',
  fallbackBody = 'Reload the inspect surface or close it to continue the conversation.',
  closeLabel = 'Close Inspect',
}: CanonicalRightSidebarProps) {
  const [shouldRenderSidebar, setShouldRenderSidebar] = useState(open);

  useEffect(() => {
    if (!prewarm) {
      setShouldRenderSidebar(open);
      return;
    }
    if (open) {
      setShouldRenderSidebar(true);
      return;
    }
    if (shouldRenderSidebar) {
      return;
    }
    const prewarmTimer = window.setTimeout(() => {
      setShouldRenderSidebar(true);
    }, prewarmDelayMs);
    return () => {
      window.clearTimeout(prewarmTimer);
    };
  }, [open, prewarm, prewarmDelayMs, shouldRenderSidebar]);

  return (
    <>
      <div
        className="absolute inset-y-0 right-0 z-30 h-full shrink-0 overflow-hidden transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{
          width: open ? `${widthPx}px` : '0px',
          opacity: open ? 1 : 0,
          transform: open ? 'translateX(0)' : 'translateX(18px)',
          pointerEvents: open ? 'auto' : 'none',
          willChange: 'width, opacity, transform',
        }}
        aria-hidden={!open}
        data-canonical-right-sidebar="true"
      >
        <div className="h-full border-l border-white/70 bg-[#f8fbfb] shadow-[-8px_0_24px_rgba(15,23,42,0.08)]" style={{ width: `${widthPx}px` }} data-canonical-right-sidebar-shell="true">
          {shouldRenderSidebar ? (
            <div className={`h-full transition-opacity duration-300 ${open ? 'opacity-100 delay-75' : 'opacity-0'}`}>
              <CanonicalRightSidebarBoundary
                resetKey={resetKey}
                title={fallbackTitle}
                body={fallbackBody}
                closeLabel={closeLabel}
                onClose={onClose}
              >
                {content}
              </CanonicalRightSidebarBoundary>
            </div>
          ) : (
            <div className="flex h-full flex-col p-4">
              <div className="h-12 w-40 animate-pulse rounded-2xl bg-slate-200/80" />
              <div className="mt-4 h-40 w-full animate-pulse rounded-[24px] bg-slate-200/75" />
              <div className="mt-4 h-16 w-full animate-pulse rounded-[24px] bg-slate-200/75" />
              <div className="mt-4 h-72 w-full animate-pulse rounded-[24px] bg-slate-200/75" />
            </div>
          )}
        </div>
      </div>

      {overlayMenu}
    </>
  );
}
