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
};

export function ChatRightPanelSettings(props: ChatRightPanelSettingsProps) {
  const { t } = useTranslation();
  return (
    <aside
      className="relative flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-l border-white/70 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
      data-right-panel="settings"
    >
      <div className="shrink-0 px-4 pt-3 pb-1">
        <p className="text-sm font-semibold text-slate-800">{t('Chat.settingsTitle', { defaultValue: 'Settings' })}</p>
        <p className="text-[11px] text-slate-400">{t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' })}</p>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
        {props.children}
      </ScrollArea>

      <RightPanelHeader onToggleSettings={props.onToggleSettings} settingsActive />
    </aside>
  );
}
