import { Component, type ReactNode } from 'react';

/**
 * Confines a demo-chunk load failure to the preview island: the landing page
 * keeps its marketing content and CTAs, and the fallback keeps its size.
 */
export class DemoErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('Landing demo preview failed to load', error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
