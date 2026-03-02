import { useMemo, useState } from 'react';
import type { LocalRuntimeModelOptionV11 } from '@renderer/features/runtime-config/state/types';
import { localAiRuntime } from '@runtime/local-ai-runtime';
import { Button, Card, Input, StatusBadge } from '../primitives';
import { filterInstalledModels, statusLabel } from './model-center-utils';

export type ModelCenterInstalledListProps = {
  sortedModels: LocalRuntimeModelOptionV11[];
  highlightLocalModelId: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onStart: (localModelId: string) => Promise<void>;
  onStop: (localModelId: string) => Promise<void>;
  onRestart: (localModelId: string) => Promise<void>;
  onRemove: (localModelId: string) => Promise<void>;
};

export function ModelCenterInstalledList(props: ModelCenterInstalledListProps) {
  const [busyByModelId, setBusyByModelId] = useState<Record<string, boolean>>({});
  const [errorByModelId, setErrorByModelId] = useState<Record<string, string>>({});
  const [confirmRemoveModelId, setConfirmRemoveModelId] = useState('');
  const [expandedModelId, setExpandedModelId] = useState('');

  const runWithModelBusy = async (localModelId: string, task: () => Promise<void>) => {
    setBusyByModelId((prev) => ({ ...prev, [localModelId]: true }));
    setErrorByModelId((prev) => ({ ...prev, [localModelId]: '' }));
    try {
      await task();
    } catch (err) {
      setErrorByModelId((prev) => ({
        ...prev,
        [localModelId]: err instanceof Error ? err.message : String(err || 'Operation failed'),
      }));
    } finally {
      setBusyByModelId((prev) => ({ ...prev, [localModelId]: false }));
    }
  };

  const filteredModels = useMemo(
    () => filterInstalledModels(props.sortedModels, props.searchQuery),
    [props.searchQuery, props.sortedModels],
  );

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">Installed Models</p>
        {props.sortedModels.length > 0 && (
          <p className="text-[11px] text-gray-500">{filteredModels.length} / {props.sortedModels.length}</p>
        )}
      </div>
      {props.sortedModels.length > 0 && (
        <Input
          label=""
          value={props.searchQuery}
          onChange={props.onSearchQueryChange}
          placeholder="Filter installed models..."
        />
      )}
      {filteredModels.length === 0 ? (
        props.sortedModels.length === 0 ? (
          <p className="text-xs text-amber-700">No local model registered. Install or import one to enable Local Runtime capability resolution.</p>
        ) : (
          <p className="text-xs text-gray-500">No models match the current filter.</p>
        )
      ) : (
        filteredModels.map((model) => {
          const busy = Boolean(busyByModelId[model.localModelId]);
          const status = statusLabel(model.status);
          const isExpanded = expandedModelId === model.localModelId;
          const isConfirmingRemove = confirmRemoveModelId === model.localModelId;
          const error = errorByModelId[model.localModelId];
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
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => setExpandedModelId(isExpanded ? '' : model.localModelId)}
                >
                  <p className="truncate text-sm font-medium text-gray-900">{model.model}</p>
                  <p className="truncate text-[11px] text-gray-500">
                    {model.localModelId} · {model.engine}
                    <span className="ml-1 text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                  </p>
                </button>
                <StatusBadge status={status} />
              </div>
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
              {isExpanded && (
                <div className="mt-2 space-y-1 rounded-md border border-gray-200 bg-white p-2.5 text-[11px] text-gray-600">
                  <p><span className="font-medium text-gray-700">Endpoint:</span> {model.endpoint}</p>
                  <p><span className="font-medium text-gray-700">Engine:</span> {model.engine}</p>
                  <p><span className="font-medium text-gray-700">Status:</span> {model.status}</p>
                  {model.hash && <p><span className="font-medium text-gray-700">Hash:</span> {model.hash}</p>}
                  {model.updatedAt && <p><span className="font-medium text-gray-700">Updated:</span> {model.updatedAt}</p>}
                </div>
              )}
              {error && (
                <p className="mt-1 text-[11px] text-rose-600">{error}</p>
              )}
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
                  onClick={() => {
                    void localAiRuntime.revealInFolder(model.localModelId);
                  }}
                >
                  Reveal
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || isConfirmingRemove}
                  onClick={() => setConfirmRemoveModelId(model.localModelId)}
                >
                  Remove
                </Button>
              </div>
              {isConfirmingRemove && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
                  <p className="flex-1 text-xs text-rose-800">
                    Remove &quot;{model.model}&quot;? This cannot be undone.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirmRemoveModelId('');
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onRemove(model.localModelId);
                      });
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRemoveModelId('')}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          );
        })
      )}
    </Card>
  );
}
