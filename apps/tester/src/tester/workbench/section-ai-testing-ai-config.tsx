import { Component, lazy, type ReactNode } from 'react';
import { Button } from '@nimiplatform/kit/ui';

// The Runtime-owned App AIConfig drawer is loaded only when the settings gear
// opens it. The always-on studio surface carries no configuration authority.
export const TesterAiConfigSettingsPanel = lazy(() =>
  import('./tester-ai-config-settings-panel.js')
    .then((module) => ({ default: module.TesterAiConfigSettingsPanel })),
);

// Isolates the on-demand App AIConfig drawer so transport or projection errors
// do not unmount the whole studio surface.
export class DrawerErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="section-ai-testing__drawer-error" role="alert">
          <strong>App AIConfig unavailable</strong>
          <p>{this.state.error.message || 'The App AIConfig surface failed to load.'}</p>
          <Button type="button" tone="secondary" size="sm" onClick={this.props.onClose}>Close</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
