import { Component, lazy, type ReactNode } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { t } from '../../shell/i18n/index.js';

// The Runtime-owned App AIConfig drawer is loaded only when the settings gear
// opens it. The always-on studio surface carries no configuration authority.
export const LabAiConfigSettingsPanel = lazy(() =>
  import('./lab-ai-config-settings-panel.js')
    .then((module) => ({ default: module.LabAiConfigSettingsPanel })),
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
          <strong>{t('Studio.drawerError.title')}</strong>
          <p>{this.state.error.message || t('Studio.drawerError.fallback')}</p>
          <Button type="button" tone="secondary" size="sm" onClick={this.props.onClose}>{t('Common.close')}</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
