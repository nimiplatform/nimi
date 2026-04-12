import { useState, type ReactNode } from 'react';
import {
  CanonicalRuntimeInspectSidebar,
  type CanonicalRuntimeInspectPanelKey,
  type CanonicalRuntimeInspectSectionData,
  type CanonicalRuntimeInspectStatusChip,
} from '@nimiplatform/nimi-kit/features/chat';

export type ChatRuntimeInspectContentProps = {
  title?: string;
  subtitle?: string | null;
  statusTitle: string;
  statusHint?: string | null;
  statusSummary?: ReactNode;
  statusChips?: readonly CanonicalRuntimeInspectStatusChip[];
  sections: readonly CanonicalRuntimeInspectSectionData[];
  initialOpenPanel?: CanonicalRuntimeInspectPanelKey | null;
};

export function RuntimeInspectCard(props: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
        {props.label}
      </div>
      <div className="mt-2 text-sm font-semibold text-gray-900">
        {props.value}
      </div>
      {props.detail ? (
        <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-500">
          {props.detail}
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeInspectUnsupportedNote(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
      {props.label}
    </div>
  );
}

export function ChatRuntimeInspectContent(props: ChatRuntimeInspectContentProps) {
  const [openPanel, setOpenPanel] = useState<CanonicalRuntimeInspectPanelKey | null>(
    props.initialOpenPanel ?? null,
  );

  return (
    <CanonicalRuntimeInspectSidebar
      title={props.title}
      subtitle={props.subtitle}
      statusTitle={props.statusTitle}
      statusHint={props.statusHint}
      statusSummary={props.statusSummary}
      statusChips={props.statusChips}
      openPanel={openPanel}
      onOpenPanel={setOpenPanel}
      onClosePanel={() => setOpenPanel(null)}
      sections={props.sections}
    />
  );
}
