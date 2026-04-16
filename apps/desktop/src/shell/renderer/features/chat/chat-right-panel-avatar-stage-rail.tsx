import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import ChatAgentAvatarVrmViewport from './chat-agent-avatar-vrm-viewport';
import { resolveChatAgentLiveAvatarRailModel } from './chat-agent-live-avatar-rail-model';
import {
  RightPanelHeader,
  type ChatRightPanelHandsFreeState,
} from './chat-right-panel-character-rail';

export type ChatRightPanelAvatarStageRailProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  onToggleSettings: () => void;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  onToggleFold?: () => void;
  handsFreeState?: ChatRightPanelHandsFreeState;
};

export function ChatRightPanelAvatarStageRail(props: ChatRightPanelAvatarStageRailProps) {
  const railModel = resolveChatAgentLiveAvatarRailModel({
    selectedTarget: props.selectedTarget,
    characterData: props.characterData,
  });
  const phase = railModel.snapshot.interaction.phase;
  const dockBusy = phase === 'thinking' || phase === 'speaking' || phase === 'listening';

  return (
    <aside
      className="relative flex min-h-0 w-[400px] shrink-0 flex-col overflow-hidden border-l border-slate-200/60 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
      data-right-panel="avatar-stage-rail"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-36px] top-[-20px] h-40 w-40 rounded-full bg-mint-100/45 blur-3xl" />
        <div className="absolute bottom-10 right-[-30px] h-44 w-44 rounded-full bg-sky-100/45 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.26),transparent_22%,transparent_78%,rgba(255,255,255,0.22))]" />
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 px-3 pb-2 pt-3">
          <div
            className="relative flex min-h-0 flex-1 overflow-hidden rounded-[30px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(244,249,248,0.44)_28%,rgba(221,236,247,0.58)_100%)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
            data-avatar-stage-viewport="true"
          >
            <span className="pointer-events-none absolute inset-x-10 top-6 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
            <span className="pointer-events-none absolute inset-x-6 bottom-5 h-10 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.08),transparent_72%)] blur-2xl" />
            <ChatAgentAvatarVrmViewport input={railModel.viewportInput} chrome="minimal" />
          </div>
        </div>
        <div className="shrink-0 px-3 pb-3">
          <div
            className="rounded-[24px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(255,255,255,0.46))] px-4 py-3 text-center shadow-[0_10px_26px_rgba(15,23,42,0.05)] backdrop-blur-sm"
            data-avatar-stage-dock="true"
          >
            <div className="flex items-center justify-center gap-2">
              <span className={cn('inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/90', dockBusy ? 'animate-pulse' : '')} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700/72">
                {railModel.statusLabel}
              </p>
            </div>
            <p className="mt-2.5 text-[1.75rem] font-black leading-tight tracking-tight text-slate-950">
              {railModel.displayName}
            </p>
          </div>
        </div>
        <RightPanelHeader
          onToggleSettings={props.onToggleSettings}
          settingsActive={props.settingsActive}
          thinkingState={props.thinkingState}
          onThinkingToggle={props.onThinkingToggle}
          onToggleFold={props.onToggleFold}
          handsFreeState={props.handsFreeState}
        />
      </div>
    </aside>
  );
}
