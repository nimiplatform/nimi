import React, { type PropsWithChildren } from 'react';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { getCurrentLocale, i18n } from '@renderer/i18n';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends React.Component<PropsWithChildren, ErrorBoundaryState> {
  constructor(props: PropsWithChildren) {
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
      // Keep the full component stack visible in devtools for fast follow-up triage.
      console.error(error);
      console.error(errorInfo.componentStack);
    }
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const locale = getCurrentLocale();
    const title = i18n.t('ErrorBoundary.rendererFailed', {
      defaultValue: locale === 'zh' ? '渲染层发生异常' : 'Renderer crashed',
    });
    const hint = i18n.t('ErrorBoundary.rendererHint', {
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
