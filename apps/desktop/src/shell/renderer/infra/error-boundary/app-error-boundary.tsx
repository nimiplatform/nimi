import React, { type MouseEvent, type PropsWithChildren } from 'react';
import { AmbientBackground, Surface } from '@nimiplatform/kit/ui';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import errorBoundaryLogoImage from '../../assets/logo.png';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { DesktopCanonicalRendererBindings } from '../../renderer/contract.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundaryImpl extends React.Component<
  PropsWithChildren<{
    readonly i18n: DesktopI18nResource;
    readonly bindings: DesktopCanonicalRendererBindings;
  }>,
  ErrorBoundaryState
> {
  constructor(props: PropsWithChildren<{
    readonly i18n: DesktopI18nResource;
    readonly bindings: DesktopCanonicalRendererBindings;
  }>) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Unexpected renderer error',
    };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logRendererEvent({
      level: 'error',
      area: 'renderer',
      message: 'action:error-boundary:caught',
      details: {
        error: error.message,
        componentStack: errorInfo.componentStack,
      },
    });

    if (import.meta.env.DEV) {
      // Keep the full component stack in renderer telemetry during local debugging.
      logRendererEvent({
        level: 'debug',
        area: 'renderer',
        message: 'action:error-boundary:dev-stack',
        details: {
          error: error.message,
          componentStack: errorInfo.componentStack,
        },
      });
    }
  }

  private onDragRegionMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const { bindings } = this.props;
    if (!bindings.app.projection.titlebarDragEnabled()) return;
    if (event.button !== 0) return;
    if (event.detail > 1) return;
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) return;
    void bindings.app.commands.startWindowDrag().catch(() => {
      // no-op
    });
  };

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { i18n, bindings } = this.props;
    const locale = i18n.getCurrentLocale();
    const title = i18n.instance.t('ErrorBoundary.rendererFailed', {
      defaultValue: locale === 'zh' ? '渲染层发生异常' : 'Renderer crashed',
    });
    const hint = i18n.instance.t('ErrorBoundary.rendererHint', {
      defaultValue: locale === 'zh'
        ? '请重启应用，或在 devtools 中查看 `renderer` 相关日志链路。'
        : 'Restart the app or inspect renderer logs in devtools.',
    });
    const reloadLabel = i18n.instance.t('ErrorBoundary.reload', {
      defaultValue: locale === 'zh' ? '重新加载' : 'Reload',
    });

    // Mirrors the SharedStatusShell visual system used by the bootstrap error
    // routes (AmbientBackground + glass Surface + token button) so the crash
    // page stays on the same design baseline without importing route modules.
    return (
      <AmbientBackground
        variant="mesh"
        className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
      >
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-20 h-8"
          onMouseDown={this.onDragRegionMouseDown}
        />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
          <Surface
            as="section"
            tone="panel"
            material="glass-regular"
            padding="none"
            className="w-full max-w-[420px] rounded-2xl px-6 py-7 sm:px-7 sm:py-8"
          >
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)]">
                <img src={errorBoundaryLogoImage} alt="" className="h-10 w-10 object-contain" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--nimi-text-primary)]">{title}</h1>
              <p className="mt-3 max-w-[28rem] break-words text-sm leading-6 text-[var(--nimi-status-danger)]">
                {this.state.message}
              </p>
              <p className="mt-4 max-w-[28rem] text-xs leading-5 text-[var(--nimi-text-secondary)]">
                {hint}
              </p>
              <button
                type="button"
                data-testid="desktop-error-boundary-reload"
                onClick={() => bindings.app.commands.reloadApplication()}
                className="mt-8 inline-flex h-10 min-w-36 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] px-5 text-sm font-semibold text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)]"
              >
                {reloadLabel}
              </button>
            </div>
          </Surface>
        </div>
      </AmbientBackground>
    );
  }
}

export function AppErrorBoundary(props: PropsWithChildren) {
  const i18n = useDesktopI18nResource();
  const bindings = useDesktopRendererBindings();
  return (
    <AppErrorBoundaryImpl i18n={i18n} bindings={bindings}>
      {props.children}
    </AppErrorBoundaryImpl>
  );
}
