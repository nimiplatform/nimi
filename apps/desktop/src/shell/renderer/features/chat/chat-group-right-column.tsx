import type { ReactNode } from 'react';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { ChatRightColumn, ChatRightColumnCard, ChatRightColumnCardTitle } from './chat-right-column-primitives';
import { ChatRightPanelSettings } from './chat-right-panel-settings';

export function ChatGroupRightColumn(props: {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  primaryContent?: ReactNode;
  settingsContent?: ReactNode;
  settingsActive: boolean;
  onToggleSettings: () => void;
  onToggleFold?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ChatRightColumn data-chat-mode-column="group">
      <ChatRightColumnCard cardKey="primary" className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <ChatRightColumnCardTitle
          title={props.characterData?.name || props.selectedTarget.title}
          subtitle={props.characterData?.handle || t('Chat.groupParticipantsLabel', { defaultValue: 'Group participants' })}
        />
        <div className="mt-4 min-h-0 flex-1">
          {props.primaryContent ?? (
            <p className="text-sm text-slate-500">
              {t('Chat.groupParticipantsEmpty', {
                defaultValue: 'Participants will appear here once the group is selected.',
              })}
            </p>
          )}
        </div>
      </ChatRightColumnCard>

      <ChatRightColumnCard cardKey="status" className="px-4 py-4">
        <ChatRightColumnCardTitle
          title={t('Chat.groupStatusTitle', { defaultValue: 'Group status' })}
          subtitle={props.characterData?.bio || t('Chat.groupStatusSummary', { defaultValue: 'Group conversation summary' })}
        />
        <div className="mt-4 flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700/72">
            {t('Chat.groupSharedThreadLabel', { defaultValue: 'Shared thread' })}
          </p>
        </div>
      </ChatRightColumnCard>

      <ChatRightPanelSettings
        onToggleSettings={props.onToggleSettings}
        onToggleFold={props.onToggleFold}
        expanded={props.settingsActive}
        collapsedSummary={t('Chat.groupSettingsCollapsedSummary', {
          defaultValue: 'Group actions and settings stay docked here.',
        })}
      >
        {props.settingsContent ?? (
          <div className="px-1 py-1">
            <ChatRightColumnCardTitle
              title={t('Chat.groupSettingsTitle', { defaultValue: 'Group' })}
              subtitle={t('Chat.groupSettingsEmpty', {
                defaultValue: 'This mode does not expose extra settings yet.',
              })}
            />
          </div>
        )}
      </ChatRightPanelSettings>
    </ChatRightColumn>
  );
}
