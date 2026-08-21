import { Component, type ErrorInfo, type ReactNode } from 'react';

type AvatarViewportErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type AvatarViewportErrorBoundaryState = {
  failed: boolean;
};

/**
 * Fail-closed boundary for backend viewport renderers: a lazy chunk failure
 * or a viewport render throw degrades to the shared placeholder surface
 * instead of tearing down the whole avatar stage. `resetKey` (the asset ref)
 * clears the failure when the stage switches to a different avatar asset.
 */
export class AvatarViewportErrorBoundary extends Component<
  AvatarViewportErrorBoundaryProps,
  AvatarViewportErrorBoundaryState
> {
  constructor(props: AvatarViewportErrorBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): AvatarViewportErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(prevProps: AvatarViewportErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
