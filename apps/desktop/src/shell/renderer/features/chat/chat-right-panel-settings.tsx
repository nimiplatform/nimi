import type { ReactNode } from 'react';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { RightPanelHeader } from './chat-right-panel-character-rail';

// ---------------------------------------------------------------------------
// Unified Settings panel — right panel content when settings is toggled
// ---------------------------------------------------------------------------

export type ChatRightPanelSettingsProps = {
  onToggleSettings: () => void;
  /** The mode-specific settings content (e.g. ChatSettingsPanel instance). */
  children: ReactNode;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
};

export function ChatRightPanelSettings(props: ChatRightPanelSettingsProps) {
  const { t } = useTranslation();
  return (
    <aside
      className="relative flex min-h-0 w-[400px] shrink-0 flex-col overflow-hidden border-l border-slate-200/60 bg-white"
      data-right-panel="settings"
    >
      <div className="shrink-0 px-4 pt-4 pb-4">
        <h1 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">{t('Chat.settingsTitle', { defaultValue: 'Settings' })}</h1>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 pb-4">
        {props.children}
      </ScrollArea>

      <RightPanelHeader onToggleSettings={props.onToggleSettings} settingsActive thinkingState={props.thinkingState} onThinkingToggle={props.onThinkingToggle} />
    </aside>
  );
}
