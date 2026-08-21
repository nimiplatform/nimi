import type { ReactNode } from 'react';
import type {
  CanonicalRuntimeInspectPanelKey,
  CanonicalRuntimeInspectProps,
  CanonicalRuntimeInspectStatusChip,
} from '../types.js';
import { CanonicalDrawerSection } from './canonical-drawer-section.js';
import { CanonicalSettingsCollapsibleSection } from './canonical-settings-controls.js';

function statusChipClass(tone: CanonicalRuntimeInspectStatusChip['tone']): string {
  if (tone === 'success') {
    return 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]';
  }
  if (tone === 'warning') {
    return 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]';
  }
  if (tone === 'danger') {
    return 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]';
  }
  return 'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]';
}

function panelLabel(panel: CanonicalRuntimeInspectPanelKey): string {
  if (panel === 'chat') {
    return 'Chat';
  }
  if (panel === 'voice') {
    return 'Voice';
  }
  if (panel === 'media') {
    return 'Visuals';
  }
  return 'Diagnostics';
}

function DisabledInspectNote(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] px-3 py-4 text-center text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">
      {props.label}
    </div>
  );
}

export function CanonicalRuntimeInspectSidebar({
  title = 'Runtime Inspect',
  subtitle = 'Chat, voice, media, and diagnostics for this conversation.',
  statusTitle = 'Conversation runtime',
  statusHint = null,
  statusSummary = null,
  statusChips = [],
  openPanel,
  onOpenPanel,
  onClosePanel,
  sections,
}: CanonicalRuntimeInspectProps) {
  return (
    <aside className="flex h-full min-h-0 w-80 shrink-0 flex-col overflow-y-auto border-l border-[var(--nimi-border-subtle)] bg-[var(--nimi-sidebar-canvas)]" data-canonical-runtime-inspect="true">
      <div className="flex items-center gap-2 border-b border-[var(--nimi-border-subtle)] px-4 py-3" data-canonical-runtime-inspect-header="true">
        <span className="text-[var(--nimi-text-secondary)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </span>
        <div>
          <h3 className="text-[length:var(--nimi-type-page-title-size)] font-black tracking-tight text-[var(--nimi-text-primary)]">{title}</h3>
          <p className="text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <CanonicalDrawerSection title={statusTitle} hint={statusHint}>
          <div className="space-y-2">
            {statusSummary ? (
              <div className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{statusSummary}</div>
            ) : null}
          </div>
          {statusChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {statusChips.map((chip) => (
                <span
                  key={`${chip.label}:${chip.tone || 'neutral'}`}
                  className={`inline-flex rounded-full px-2 py-0.5 text-[length:var(--nimi-type-overline-size)] font-semibold ${statusChipClass(chip.tone)}`}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          ) : null}
        </CanonicalDrawerSection>

        {sections.map((section) => {
          const isOpen = openPanel === section.key;
          return (
            <div key={section.key} data-canonical-runtime-panel={section.key}>
              <CanonicalDrawerSection
                title={section.title}
                hint={section.hint}
              >
                {section.summary ? (
                  <div className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{section.summary}</div>
                ) : null}
                <CanonicalSettingsCollapsibleSection
                  title={panelLabel(section.key)}
                  open={isOpen}
                  onToggle={() => (isOpen ? onClosePanel() : onOpenPanel(section.key))}
                >
                  {section.content ? (
                    section.content
                  ) : (
                    <DisabledInspectNote
                      label={section.disabledReason || 'This inspect panel is not available for the current source.'}
                    />
                  )}
                </CanonicalSettingsCollapsibleSection>
              </CanonicalDrawerSection>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export type { CanonicalRuntimeInspectProps };
