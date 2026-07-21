import React, { type PropsWithChildren } from 'react';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundaryImpl extends React.Component<
  PropsWithChildren<{ readonly i18n: DesktopI18nResource }>,
  ErrorBoundaryState
> {
  constructor(props: PropsWithChildren<{ readonly i18n: DesktopI18nResource }>) {
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

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { i18n } = this.props;
    const locale = i18n.getCurrentLocale();
    const title = i18n.instance.t('ErrorBoundary.rendererFailed', {
      defaultValue: locale === 'zh' ? '渲染层发生异常' : 'Renderer crashed',
    });
    const hint = i18n.instance.t('ErrorBoundary.rendererHint', {
      defaultValue: locale === 'zh'
        ? '请重启应用，或在 devtools 中查看 `renderer` 相关日志链路。'
        : 'Restart the app or inspect renderer logs in devtools.',
    });

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-red-700">{title}</h1>
          <p className="mt-2 text-sm text-gray-600">{this.state.message}</p>
          <p className="mt-4 text-xs text-gray-500">
            {hint}
          </p>
        </div>
      </div>
    );
  }
}

export function AppErrorBoundary(props: PropsWithChildren) {
  const i18n = useDesktopI18nResource();
  return <AppErrorBoundaryImpl i18n={i18n}>{props.children}</AppErrorBoundaryImpl>;
}
