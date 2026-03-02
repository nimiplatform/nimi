import { useState } from 'react';
import type { LocalRuntimeModelOptionV11 } from '@renderer/features/runtime-config/state/types';
import { Button, Card, StatusBadge } from '../primitives';
import { statusLabel } from './model-center-utils';

export type ModelCenterInstalledListProps = {
  sortedModels: LocalRuntimeModelOptionV11[];
  highlightLocalModelId: string;
  onStart: (localModelId: string) => Promise<void>;
  onStop: (localModelId: string) => Promise<void>;
  onRestart: (localModelId: string) => Promise<void>;
  onRemove: (localModelId: string) => Promise<void>;
};

export function ModelCenterInstalledList(props: ModelCenterInstalledListProps) {
  const [busyByModelId, setBusyByModelId] = useState<Record<string, boolean>>({});

  const runWithModelBusy = async (localModelId: string, task: () => Promise<void>) => {
    setBusyByModelId((prev) => ({ ...prev, [localModelId]: true }));
    try {
      await task();
    } finally {
      setBusyByModelId((prev) => ({ ...prev, [localModelId]: false }));
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <p className="text-sm font-semibold text-gray-900">Installed Models</p>
      {props.sortedModels.length === 0 ? (
        <p className="text-xs text-amber-700">No local model registered. Install or import one to enable Local Runtime capability resolution.</p>
      ) : (
        props.sortedModels.map((model) => {
          const busy = Boolean(busyByModelId[model.localModelId]);
          const status = statusLabel(model.status);
          return (
            <div
              key={`local-runtime-model-${model.localModelId}`}
              className={`rounded-[10px] border bg-gray-50 p-3 ${
                props.highlightLocalModelId === model.localModelId
                  ? 'border-emerald-300 ring-1 ring-emerald-200'
                  : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{model.model}</p>
                  <p className="truncate text-[11px] text-gray-500">{model.localModelId} · {model.engine}</p>
                  {props.highlightLocalModelId === model.localModelId ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700">
                      Newly installed model is ready for capability selection.
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-gray-600">
                    {(model.capabilities || []).join(', ') || 'chat'}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Installed: {model.installedAt || '-'}
                  </p>
                </div>
                <StatusBadge status={status} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || model.status === 'active'}
                  onClick={() => {
                    void runWithModelBusy(model.localModelId, async () => {
                      await props.onStart(model.localModelId);
                    });
                  }}
                >
                  Start
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || model.status !== 'active'}
                  onClick={() => {
                    void runWithModelBusy(model.localModelId, async () => {
                      await props.onStop(model.localModelId);
                    });
                  }}
                >
                  Stop
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void runWithModelBusy(model.localModelId, async () => {
                      await props.onRestart(model.localModelId);
                    });
                  }}
                >
                  Restart
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void runWithModelBusy(model.localModelId, async () => {
                      await props.onRemove(model.localModelId);
                    });
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}
