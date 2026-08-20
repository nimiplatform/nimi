import { Component, type ReactNode } from 'react';
import { Button } from '@nimiplatform/kit/ui';

import type { StudioTranslate } from './non-success-presentation.js';

export class DrawerErrorBoundary extends Component<{
  readonly onClose: () => void;
  readonly translate: StudioTranslate;
  readonly children: ReactNode;
}, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      const { translate } = this.props;
      return (
        <div className="section-ai-testing__drawer-error" role="alert">
          <strong>{translate('Studio.drawerError.title')}</strong>
          <p>{this.state.error.message || translate('Studio.drawerError.fallback')}</p>
          <Button type="button" tone="secondary" size="sm" onClick={this.props.onClose}>{translate('Common.close')}</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
