import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ModelConfigSection,
  ModelConfigCapabilityStatusTone,
  ModelConfigProfileController,
} from '@nimiplatform/nimi-kit/features/model-config';
import { ProfileConfigSection } from '@nimiplatform/nimi-kit/features/model-config';
import { SettingsSummaryCard } from './chat-settings-summary-card';

// ---------------------------------------------------------------------------
// ChatSettingsSummaryHome — summary card view for the settings panel
// ---------------------------------------------------------------------------

type SummaryModuleId = 'profile' | 'chat' | 'tts' | 'image' | 'video';

const MODULE_ORDER: SummaryModuleId[] = ['profile', 'chat', 'tts', 'image', 'video'];

const SECTION_TO_MODULE: Record<string, SummaryModuleId> = {
  chat: 'chat',
  tts: 'tts',
  image: 'image',
  video: 'video',
};

function deriveSectionSummary(section: ModelConfigSection): {
  subtitle: string | null;
  statusDot: ModelConfigCapabilityStatusTone;
  statusLabel: string | null;
} {
  const primaryItem = section.items?.[0];
  if (!primaryItem) {
    return { subtitle: null, statusDot: 'neutral', statusLabel: null };
  }
  const binding = primaryItem.binding;
  const subtitle = binding?.modelLabel || binding?.model || null;
  const statusDot = primaryItem.status?.tone ?? 'neutral';
  const statusLabel = primaryItem.status?.badgeLabel ?? null;
  return { subtitle, statusDot, statusLabel };
}

export type ChatSettingsAvatarSummary = {
  title: string;
  subtitle?: string | null;
  statusDot?: 'ready' | 'attention' | 'neutral';
  statusLabel?: string | null;
};

export type ChatSettingsSummaryHomeProps = {
  sections: ModelConfigSection[];
  profile?: ModelConfigProfileController;
  onSelectModule: (moduleId: string) => void;
  schedulingContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  avatarSummary?: ChatSettingsAvatarSummary | null;
};

export function ChatSettingsSummaryHome({
  sections,
  profile,
  onSelectModule,
  schedulingContent,
  diagnosticsContent,
  avatarSummary,
}: ChatSettingsSummaryHomeProps) {
  const { t } = useTranslation();

  const sectionByModule = new Map<string, ModelConfigSection>();
  for (const section of sections) {
    const moduleId = SECTION_TO_MODULE[section.id];
    if (moduleId && !section.hidden) {
      sectionByModule.set(moduleId, section);
    }
  }

  const capabilityModules = MODULE_ORDER.filter((m) => m !== 'profile');
  const hasCapabilities = capabilityModules.some((m) => sectionByModule.has(m));

  return (
    <div className="space-y-2">
      {/* ── Identity Header: AI Profile ── */}
      {profile ? (
        <div key="profile">
          <ProfileConfigSection controller={profile} />
        </div>
      ) : null}

      {/* ── Avatar module (identity / presentation) ── */}
      {avatarSummary ? (
        <>
          {profile ? (
            <div className="mb-2 border-t border-slate-100 px-6 pt-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                {t('Chat.avatarSectionLabel', { defaultValue: 'Avatar' })}
              </h3>
            </div>
          ) : null}
          <SettingsSummaryCard
            key="avatar"
            title={avatarSummary.title}
            subtitle={avatarSummary.subtitle}
            statusDot={avatarSummary.statusDot}
            statusLabel={avatarSummary.statusLabel}
            onClick={() => onSelectModule('avatar')}
          />
        </>
      ) : null}

      {/* ── Divider + Section Label ── */}
      {(profile || avatarSummary) && hasCapabilities ? (
        <div className="mb-3 border-t border-slate-100 px-6 pt-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
            {t('Chat.modelCapabilitiesLabel', { defaultValue: 'Model Capabilities' })}
          </h3>
        </div>
      ) : null}

      {/* ── Capability Cards ── */}
      {capabilityModules.map((moduleId) => {
        const section = sectionByModule.get(moduleId);
        if (!section) {
          return null;
        }
        const summary = deriveSectionSummary(section);
        return (
          <SettingsSummaryCard
            key={moduleId}
            title={section.title}
            subtitle={summary.subtitle}
            statusDot={summary.statusDot}
            statusLabel={summary.statusLabel}
            onClick={() => onSelectModule(moduleId)}
          />
        );
      })}

      {/* Bottom area: Scheduling + Diagnostics */}
      {schedulingContent || diagnosticsContent ? (
        <div className="mt-3 space-y-2 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)] pt-3">
          {schedulingContent}
          {diagnosticsContent ? (
            <button
              type="button"
              onClick={() => onSelectModule('diagnostics')}
              className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs text-[var(--nimi-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)] hover:text-[var(--nimi-text-secondary)]"
            >
              <span>{t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--nimi-text-muted)]">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
