/**
 * Advanced section — canonical six-section Runtime IA.
 *
 * Hosts advanced runtime preferences and updates.
 */

import { PerformancePage } from '../settings/settings-performance-page';

export function AdvancedPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <div data-testid="runtime-advanced-pane:preferences">
          <PerformancePage />
        </div>
      </div>
    </div>
  );
}
