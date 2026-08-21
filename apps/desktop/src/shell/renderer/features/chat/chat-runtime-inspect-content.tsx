import { useState, type ReactNode } from 'react';
import { AppCardSurface } from '@nimiplatform/kit/ui';
import { CanonicalRuntimeInspectSidebar } from '@nimiplatform/kit/features/chat/components/canonical-runtime-inspect-sidebar';
import {
  type CanonicalRuntimeInspectPanelKey,
  type CanonicalRuntimeInspectSectionData,
  type CanonicalRuntimeInspectStatusChip,
} from '@nimiplatform/kit/features/chat/headless';

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
    <AppCardSurface kind="operational-solid" as="div" className="px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
        {props.label}
      </div>
      <div className="mt-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
        {props.value}
      </div>
      {props.detail ? (
        <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--nimi-text-secondary)]">
          {props.detail}
        </div>
      ) : null}
    </AppCardSurface>
  );
}

export function RuntimeInspectUnsupportedNote(props: { label: string }) {
  return (
    <AppCardSurface kind="operational-solid" as="div" className="border-dashed px-3 py-4 text-center text-[11px] text-[var(--nimi-text-muted)]">
      {props.label}
    </AppCardSurface>
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
