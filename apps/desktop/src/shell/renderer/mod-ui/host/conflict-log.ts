import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import type { UiSlotId } from '@renderer/mod-ui/contracts';

type SlotConflict = {
  strategy: string;
  priority: number;
  extensionIds: string[];
};

export function logSlotConflicts(slot: UiSlotId, conflicts: SlotConflict[]) {
  if (conflicts.length === 0) {
    return;
  }
  for (const conflict of conflicts) {
    logRendererEvent({
      level: 'warn',
      area: 'mod-ui',
      message: 'action:mod-ui-conflict',
      details: {
        slot,
        strategy: conflict.strategy,
        priority: conflict.priority,
        extensionIds: conflict.extensionIds,
      },
    });
  }
}
