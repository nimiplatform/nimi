import { useState } from 'react';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import { ModelPickerModal, ModelSelectorTrigger } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { bindingToPickerSelection, pickerSelectionToBinding } from '../binding-helpers.js';
import type { CapabilityModelCardProps, ModelConfigCapabilityStatus } from '../types.js';
import { DisabledConfigNote } from './config-section.js';

function statusToneClasses(status: ModelConfigCapabilityStatus | null | undefined): {
  dot: string;
  badge: string;
  title: string;
} {
  if (status?.supported) {
    return {
      dot: 'bg-emerald-400',
      badge: 'bg-emerald-50 text-emerald-700',
      title: 'text-emerald-700',
    };
  }
  if (status?.tone === 'attention') {
    return {
      dot: 'bg-amber-400',
      badge: 'bg-amber-50 text-amber-700',
      title: 'text-amber-700',
    };
  }
  return {
    dot: 'bg-slate-300',
    badge: 'bg-slate-100 text-slate-600',
    title: 'text-slate-600',
  };
}

export function CapabilityModelCard({ item }: CapabilityModelCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const shouldShowEditor = item.editor && (
    item.showEditorWhen !== 'local'
    || item.binding?.source === 'local'
  );

  if (!item.provider) {
    return (
      <div className="space-y-2">
        <DisabledConfigNote label={item.runtimeNotReadyLabel || 'Runtime not ready'} />
        {shouldShowEditor ? item.editor : null}
      </div>
    );
  }

  const selection = bindingToPickerSelection(item.binding);
  const displayLabel = selection.modelLabel || selection.model || null;
  const source = selection.source || null;
  const connectorDetail = source === 'cloud' && selection.connectorId ? selection.connectorId : null;
  const statusClasses = statusToneClasses(item.status);

  const labelNode = item.detail ? (
    <Tooltip content={item.detail} placement="top">
      <span className="text-xs font-medium text-slate-500">{item.label}</span>
    </Tooltip>
  ) : (
    <span className="text-xs font-medium text-slate-500">{item.label}</span>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {labelNode}
        {item.status ? (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClasses.dot}`} />
        ) : null}
        {item.status?.badgeLabel ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasses.badge}`}>
            {item.status.badgeLabel}
          </span>
        ) : null}
      </div>

      <ModelSelectorTrigger
        source={source}
        modelLabel={displayLabel}
        detail={connectorDetail}
        placeholder={item.placeholder}
        onClick={() => setModalOpen(true)}
        disabled={item.disabled}
      />

      <ModelPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        capability={item.routeCapability}
        capabilityLabel={item.label}
        provider={item.provider}
        initialSelection={selection}
        onSelect={(pickerSelection: RouteModelPickerSelection) => {
          item.onBindingChange(pickerSelectionToBinding(pickerSelection));
        }}
      />

      {item.status?.title || item.status?.detail ? (
        <div className="space-y-0.5">
          {item.status?.title ? (
            <div className={`text-[11px] font-medium ${statusClasses.title}`}>
              {item.status.title}
            </div>
          ) : null}
          {item.status?.detail ? (
            <div className="text-[11px] text-slate-500">
              {item.status.detail}
            </div>
          ) : null}
        </div>
      ) : null}

      {item.showClearButton && item.binding ? (
        <button
          type="button"
          onClick={() => item.onBindingChange(null)}
          className="text-xs text-slate-400 transition-colors hover:text-slate-600"
        >
          {item.clearSelectionLabel || 'Clear selection'}
        </button>
      ) : null}

      {shouldShowEditor ? item.editor : null}
    </div>
  );
}
