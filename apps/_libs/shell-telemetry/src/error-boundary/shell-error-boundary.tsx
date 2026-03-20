import React, { type PropsWithChildren } from 'react';
import { logRendererEvent } from '../telemetry/emit.js';

const MAX_ERROR_MESSAGE_CHARS = 512;
const MAX_COMPONENT_STACK_CHARS = 2048;

function truncateForTelemetry(value: string | null | undefined, maxChars: number): string {
  const normalized = String(value || '');
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...[truncated]` : normalized;
}

type ShellErrorBoundaryProps = PropsWithChildren<{
  appName: string;
  fallbackTitle?: string;
  fallbackHint?: string;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}>;

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ShellErrorBoundary extends React.Component<ShellErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ShellErrorBoundaryProps) {
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
        appName: this.props.appName,
        error: truncateForTelemetry(error.message, MAX_ERROR_MESSAGE_CHARS),
        componentStack: truncateForTelemetry(errorInfo.componentStack, MAX_COMPONENT_STACK_CHARS),
      },
    });

    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      logRendererEvent({
        level: 'debug',
        area: 'renderer',
        message: 'action:error-boundary:dev-stack',
        details: {
          appName: this.props.appName,
          error: truncateForTelemetry(error.message, MAX_ERROR_MESSAGE_CHARS),
          componentStack: truncateForTelemetry(errorInfo.componentStack, MAX_COMPONENT_STACK_CHARS),
        },
      });
    }

    this.props.onError?.(error, errorInfo);
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const title = this.props.fallbackTitle || `${this.props.appName} 渲染层发生异常`;
    const hint = this.props.fallbackHint || '请重启应用，或在 devtools 中查看 `renderer` 相关日志链路。';

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-red-700">{title}</h1>
          <p className="mt-2 text-sm text-gray-600">{this.state.message}</p>
          <p className="mt-4 text-xs text-gray-500">{hint}</p>
        </div>
      </div>
    );
  }
}
