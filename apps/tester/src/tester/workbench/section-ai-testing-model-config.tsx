import { Component, lazy, type ReactNode } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import {
  DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
  createRendererEntryModuleLoader,
} from '@nimiplatform/kit/shell/renderer/bootstrap';

// The model-config drawer (and its runtime model-picker provider) is only needed
// when the settings gear opens it, so it loads on demand - the always-on studio
// surface stays decoupled from the heavier config subsystem.
const testerModelConfigPanelLoader = createRendererEntryModuleLoader({
  retryDelaysMs: DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
});

export const TesterAiConfigSettingsPanel = lazy(() =>
  testerModelConfigPanelLoader
    .load('tester model config panel', () => import('./tester-ai-config-settings-panel.js'))
    .then((module) => ({ default: module.TesterAiConfigSettingsPanel })),
);

// Isolates the on-demand model-config drawer: if the panel module (or one of its
// runtime model-picker dependencies) fails to load, the drawer degrades to an
// inline error instead of unmounting the whole studio surface.
export class DrawerErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="section-ai-testing__drawer-error" role="alert">
          <strong>Model config unavailable</strong>
          <p>{this.state.error.message || 'The model config surface failed to load.'}</p>
          <Button type="button" tone="secondary" size="sm" onClick={this.props.onClose}>Close</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
