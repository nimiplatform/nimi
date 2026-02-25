import React from 'react';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { i18n } from '@renderer/i18n';

type ModExtensionErrorBoundaryProps = React.PropsWithChildren<{
  extensionId: string;
  modId: string;
  slot: string;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}>;

type ModExtensionErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ModExtensionErrorBoundary extends React.Component<
  ModExtensionErrorBoundaryProps,
  ModExtensionErrorBoundaryState
> {
  constructor(props: ModExtensionErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
    };
  }

  static getDerivedStateFromError(error: Error): ModExtensionErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'mod extension render failed',
    };
  }

  override componentDidCatch(error: Error): void {
    logRendererEvent({
      level: 'error',
      area: 'mod-ui',
      message: 'mod-ui:extension-render:failed',
      details: {
        extensionId: this.props.extensionId,
        modId: this.props.modId,
        slot: this.props.slot,
        error: error?.message || 'unknown error',
      },
    });
    this.props.onError?.(error);
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <section className="m-4 rounded-xl border border-red-200 bg-white p-3 text-xs text-gray-700">
        <p className="font-semibold text-red-700">
          {i18n.t('ModUI.extensionFailedTitle', { defaultValue: 'Mod extension failed' })}
        </p>
        <p className="mt-1 text-gray-600">{this.props.modId}</p>
        <p className="mt-2 text-gray-500 break-all">{this.state.message}</p>
      </section>
    );
  }
}
