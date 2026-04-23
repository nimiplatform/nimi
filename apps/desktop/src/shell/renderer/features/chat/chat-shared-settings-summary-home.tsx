import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ModelConfigSection,
  ModelConfigProfileController,
} from '@nimiplatform/nimi-kit/features/model-config';
import { ProfileConfigSection } from '@nimiplatform/nimi-kit/features/model-config';
import { SettingsSummaryCard } from './chat-shared-settings-summary-card';
import { summarizeAiModelAggregate } from './chat-shared-settings-ai-model-home';

// ---------------------------------------------------------------------------
// ChatSettingsSummaryHome — compacted to four top-level entries:
//   Avatar · AI Model · Diagnostics · Clear chats
// ---------------------------------------------------------------------------

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
  onClearChats?: () => void;
  clearChatsDisabled?: boolean;
};

export function ChatSettingsSummaryHome({
  sections,
  profile,
  onSelectModule,
  schedulingContent,
  diagnosticsContent,
  avatarSummary,
  onClearChats,
  clearChatsDisabled,
}: ChatSettingsSummaryHomeProps) {
  const { t } = useTranslation();

  const aiModelAggregate = summarizeAiModelAggregate(sections, {
    ready: t('Chat.settingsAiModelCountReady', { defaultValue: '{{count}} ready' }),
    attention: t('Chat.settingsAiModelCountAttention', { defaultValue: '{{count}} needs setup' }),
    neutral: t('Chat.settingsAiModelCountNeutral', { defaultValue: '{{count}} unconfigured' }),
  });

  const hasAiModel = sections.some((s) => !s.hidden && ['chat', 'tts', 'stt', 'image', 'video', 'embed'].includes(s.id));

  return (
    <div className="space-y-2">
      {/* Profile import (unchanged) */}
      {profile ? (
        <div key="profile">
          <ProfileConfigSection controller={profile} variant="import-button" />
        </div>
      ) : null}

      {/* Top-level entries: Avatar / AI Model */}
      {(avatarSummary || hasAiModel) ? (
        <div className="space-y-2 pt-1">
          {avatarSummary ? (
            <SettingsSummaryCard
              key="avatar"
              title={avatarSummary.title}
              subtitle={avatarSummary.subtitle}
              statusDot={avatarSummary.statusDot}
              statusLabel={avatarSummary.statusLabel}
              onClick={() => onSelectModule('avatar')}
            />
          ) : null}

          {hasAiModel ? (
            <SettingsSummaryCard
              key="ai-model"
              title={t('Chat.settingsAiModelEntryTitle', { defaultValue: 'AI Model' })}
              subtitle={aiModelAggregate.subtitle || t('Chat.settingsAiModelEntrySubtitle', { defaultValue: 'Chat · TTS · STT · Image · Video' })}
              statusDot={aiModelAggregate.statusDot}
              statusLabel={null}
              onClick={() => onSelectModule('ai-model')}
            />
          ) : null}
        </div>
      ) : null}

      {/* Bottom actions: Scheduling / Diagnostics / Clear chats */}
      {(schedulingContent || diagnosticsContent || onClearChats) ? (
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
          {onClearChats ? (
            <button
              type="button"
              onClick={onClearChats}
              disabled={clearChatsDisabled}
              className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] disabled:pointer-events-none disabled:opacity-50"
            >
              <span>{t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' })}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
