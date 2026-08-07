import { useState, type ReactNode } from 'react';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { useModelPicker } from '../hooks/use-model-picker.js';
import type { ModelPickerCandidateAdapter, ModelPickerCopy, ModelPickerPresentation } from '../types.js';
import { ModelPicker } from './model-picker.js';
import { ModelPickerDetail } from './model-picker-detail.js';

export type ModelPickerDialogProps<TCandidate> = {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly adapter: ModelPickerCandidateAdapter<TCandidate>;
  readonly selectedId?: string;
  readonly initialSourceFilter?: string;
  readonly sourceOptions?: readonly string[];
  readonly presentation?: ModelPickerPresentation;
  readonly copy?: ModelPickerCopy;
  readonly renderItemActions?: (candidate: TCandidate) => ReactNode;
  readonly renderSourceControls?: (input: {
    readonly source: string;
    readonly isLoading: boolean;
    readonly clearSelection: () => void;
  }) => ReactNode;
  readonly onClose: () => void;
  readonly onConfirm: (candidate: TCandidate) => void;
};

function OpenModelPickerDialog<TCandidate>({
  title,
  description,
  adapter,
  selectedId = '',
  initialSourceFilter = 'all',
  sourceOptions,
  presentation = 'browser',
  copy,
  renderItemActions,
  renderSourceControls,
  onClose,
  onConfirm,
}: ModelPickerDialogProps<TCandidate>) {
  const [draftId, setDraftId] = useState(selectedId);
  const state = useModelPicker({
    adapter,
    selectedId: draftId,
    initialSourceFilter,
    sourceOptions,
    onSelectCandidate: (id) => setDraftId(id),
  });
  const routePresentation = presentation === 'route';
  return (
    <OverlayShell
      open
      size={routePresentation ? 'S' : 'L'}
      onClose={onClose}
      title={title}
      description={description ? <p className="m-0 mt-1 text-sm font-normal text-[var(--nimi-text-secondary)]">{description}</p> : undefined}
      contentClassName={routePresentation
        ? 'flex max-h-[min(68vh,560px)] min-h-[320px] flex-col overflow-hidden py-3'
        : 'grid max-h-[min(72vh,760px)] min-h-0 gap-3 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]'}
      footer={(
        <div className="flex justify-end gap-2 px-4 py-3">
          <Button tone="secondary" onClick={onClose}>{copy?.cancelLabel || 'Cancel'}</Button>
          <Button
            tone="primary"
            disabled={!state.selectedCandidate}
            onClick={() => {
              if (!state.selectedCandidate) return;
              onConfirm(state.selectedCandidate);
              onClose();
            }}
          >
            {copy?.confirmLabel || 'Use selection'}
          </Button>
        </div>
      )}
      dataTestId="nimi-model-picker-dialog"
    >
      <ModelPicker
        state={state}
        copy={copy}
        presentation={presentation}
        renderItemActions={renderItemActions}
        sourceControls={renderSourceControls?.({
          source: state.sourceFilter,
          isLoading: state.isLoading,
          clearSelection: () => setDraftId(''),
        })}
        className={routePresentation ? 'flex min-h-0 flex-1 flex-col' : undefined}
      />
      {routePresentation ? null : <ModelPickerDetail state={state} emptyMessage={copy?.detailEmptyLabel} />}
    </OverlayShell>
  );
}

export function ModelPickerDialog<TCandidate>(props: ModelPickerDialogProps<TCandidate>) {
  if (!props.open) return null;
  return <OpenModelPickerDialog {...props} />;
}
