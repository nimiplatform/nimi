import { useState, type ReactNode } from 'react';
import { DesktopCardSurface } from '@renderer/components/surface';
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
    <DesktopCardSurface kind="operational-solid" as="div" className="px-3 py-3">
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
    </DesktopCardSurface>
  );
}

export function RuntimeInspectUnsupportedNote(props: { label: string }) {
  return (
    <DesktopCardSurface kind="operational-solid" as="div" className="border-dashed px-3 py-4 text-center text-[11px] text-gray-500">
      {props.label}
    </DesktopCardSurface>
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
