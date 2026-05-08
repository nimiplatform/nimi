import React, { useEffect, useState, type ReactNode } from 'react';
import { Button, SidebarShell, Surface } from '@nimiplatform/nimi-kit/ui';

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
      <div className="flex h-full flex-col justify-between border-l border-[var(--nimi-border-subtle)] bg-[var(--nimi-sidebar-canvas)] p-4">
        <Surface tone="card" elevation="raised" padding="md">
          <p className="text-base font-semibold text-[var(--nimi-status-danger)]">{this.props.title}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">{this.props.body}</p>
          <p className="mt-3 rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-xs text-[var(--nimi-text-muted)]">
            {String(this.state.error.message || this.state.error.name || 'right sidebar error')}
          </p>
        </Surface>
        <Button
          onClick={this.props.onClose}
          tone="secondary"
          size="sm"
          className="rounded-[var(--nimi-radius-full)]"
        >
          {this.props.closeLabel}
        </Button>
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
        <SidebarShell
          as="div"
          className="h-full rounded-none border-y-0 border-r-0 bg-[var(--nimi-sidebar-canvas)] shadow-[var(--nimi-elevation-floating)]"
          style={{ width: `${widthPx}px` }}
          data-canonical-right-sidebar-shell="true"
        >
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
              <div className="h-12 w-40 animate-pulse rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)]" />
              <div className="mt-4 h-40 w-full animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)]" />
              <div className="mt-4 h-16 w-full animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)]" />
              <div className="mt-4 h-72 w-full animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)]" />
            </div>
          )}
        </SidebarShell>
      </div>

      {overlayMenu}
    </>
  );
}
