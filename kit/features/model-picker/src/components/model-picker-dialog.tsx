import { useEffect, useState } from 'react';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { useModelPicker } from '../hooks/use-model-picker.js';
import type { ModelPickerCandidateAdapter, ModelPickerCopy } from '../types.js';
import { ModelPicker } from './model-picker.js';
import { ModelPickerDetail } from './model-picker-detail.js';

export type ModelPickerDialogProps<TCandidate> = {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly adapter: ModelPickerCandidateAdapter<TCandidate>;
  readonly selectedId?: string;
  readonly copy?: ModelPickerCopy;
  readonly onClose: () => void;
  readonly onConfirm: (candidate: TCandidate) => void;
};

export function ModelPickerDialog<TCandidate>({ open, title, description, adapter, selectedId = '', copy, onClose, onConfirm }: ModelPickerDialogProps<TCandidate>) {
  const [draftId, setDraftId] = useState(selectedId);
  useEffect(() => {
    if (open) setDraftId(selectedId);
  }, [open, selectedId]);
  const state = useModelPicker({ adapter, selectedId: draftId, onSelectCandidate: (id) => setDraftId(id) });
  return (
    <OverlayShell
      open={open}
      size="L"
      onClose={onClose}
      title={title}
      description={description ? <p className="m-0 mt-1 text-sm font-normal text-[var(--nimi-text-secondary)]">{description}</p> : undefined}
      contentClassName="grid max-h-[min(72vh,760px)] min-h-0 gap-3 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]"
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
      <ModelPicker state={state} copy={copy} />
      <ModelPickerDetail state={state} emptyMessage={copy?.detailEmptyLabel} />
    </OverlayShell>
  );
}
