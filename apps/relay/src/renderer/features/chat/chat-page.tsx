// Chat page — Jan-like direct LLM chat with optional agent mode
// Direct mode: agent-less chat via relay:direct-chat:* IPC
// Agent mode: beat-first pipeline via relay:chat:* IPC (RL-PIPE-001)

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Settings, Check, X, User } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
} from '@nimiplatform/nimi-kit/ui';
import {
  ChatComposerResizeHandle,
  ChatComposerShell,
} from '@nimiplatform/nimi-kit/features/chat/ui';
import { useChat } from './hooks/use-chat.js';
import { ChatView } from './components/chat-view.js';
import { MessageInput } from './components/message-input.js';
import { EmptyState } from './components/empty-state.js';
import { VoiceControls } from '../voice/components/voice-controls.js';
import { useAppStore, type Agent } from '../../app-shell/providers/app-store.js';
import { getBridge } from '../../bridge/electron-bridge.js';
import { useAgentProfile } from '../agent/hooks/use-agent-profile.js';

export function ChatPage() {
  const { t } = useTranslation();
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const setDetailMode = useAppStore((s) => s.setDetailMode);
  const [composerHeight, setComposerHeight] = useState(160);
  const composerResizingRef = useRef(false);
  const chatLayoutRef = useRef<HTMLDivElement>(null);

  const ai = useChat();

  const lastAssistantText = ai.messages
    .filter((m) => m.role === 'assistant' && m.kind !== 'streaming' && m.content)
    .at(-1)?.content;

  const handleTranscript = useCallback((text: string) => {
    if (text.trim()) ai.sendMessage(text.trim());
  }, [ai.sendMessage]);

  // Composer resize handlers (matching desktop pattern)
  const startComposerResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    composerResizingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!composerResizingRef.current || !chatLayoutRef.current) return;
      const rect = chatLayoutRef.current.getBoundingClientRect();
      const nextHeight = Math.min(340, Math.max(120, rect.bottom - ev.clientY));
      setComposerHeight(nextHeight);
    };

    const onMouseUp = () => {
      composerResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleRetryRuntime = useCallback(async () => {
    try {
      const bridge = getBridge();
      await bridge.health();
      useAppStore.getState().setRuntimeAvailable(true);
    } catch (err) {
      console.warn('[relay:chat] runtime health retry failed', err);
    }
  }, []);

  const placeholder = currentAgent
    ? t('chat.messageAgent', { name: currentAgent.name })
    : t('chat.typeMessage');

  return (
    <div ref={chatLayoutRef} className="flex flex-col h-full">
      {/* Header — model picker (primary) + agent pill + settings */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2 min-w-0" />
        <div className="flex items-center gap-1">
          <AgentPill agent={currentAgent} />
          <button
            onClick={() => setDetailMode('settings')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
            title={t('settings.title', 'Settings')}
          >
            <Settings size={17} />
          </button>
        </div>
      </div>

      {/* Status banner */}
      {ai.statusBanner && (
        <div className={`px-6 py-2 text-[12px] ${
          ai.statusBanner.kind === 'error' ? 'bg-error/10 text-error' :
          ai.statusBanner.kind === 'warning' ? 'bg-warning/10 text-warning' :
          ai.statusBanner.kind === 'success' ? 'bg-success/10 text-success' :
          'bg-accent/10 text-accent'
        }`}>
          {ai.statusBanner.message}
        </div>
      )}

      {/* Chat content */}
      {!runtimeAvailable ? (
        <RuntimeUnavailable onRetry={handleRetryRuntime} feature={t('chat.aiChat')} />
      ) : (
        <>
          {ai.messages.length === 0 ? (
            <EmptyState
              agentName={currentAgent?.name}
              agentAvatarUrl={currentAgent?.avatarUrl}
            />
          ) : (
            <ChatView messages={ai.messages} sendPhase={ai.sendPhase} />
          )}
          <ChatComposerResizeHandle onMouseDown={startComposerResize} />
          <ChatComposerShell height={composerHeight}>
            <MessageInput
              onSend={ai.sendMessage}
              disabled={!ai.canChat || ai.isSending}
              placeholder={placeholder}
              isSending={ai.isSending}
              sendPhase={ai.sendPhase}
              onCancelTurn={() => ai.cancelTurn()}
              modelPickerSlot={null}
              toolbar={
                currentAgent ? (
                  <VoiceControls
                    onTranscript={handleTranscript}
                    lastAssistantText={lastAssistantText}
                  />
                ) : null
              }
            />
          </ChatComposerShell>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentPill — compact agent control in header
// ---------------------------------------------------------------------------

function AgentPill({ agent }: { agent: Agent | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { fetchAgentList, selectAgent } = useAgentProfile();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const setAgent = useAppStore((s) => s.setAgent);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchAgentList()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [open, fetchAgentList]);

  const handleSelect = (a: Agent) => {
    selectAgent(a);
    setOpen(false);
  };

  const handleClear = () => {
    setAgent(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {agent ? (
          <button className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary">
            <AgentAvatar agent={agent} size={20} />
            <span className="max-w-[100px] truncate">{agent.name}</span>
            <ChevronDown size={12} className="text-text-muted" />
          </button>
        ) : (
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
            title={t('agent.addAgent', 'Add Agent')}
          >
            <User size={17} />
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[280px] p-0">
        <div className="px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--nimi-text-muted)]">
            {t('agent.switchAgent')}
          </span>
        </div>
        <div className="border-t border-[color:var(--nimi-border-subtle)]">
          <ScrollArea viewportClassName="max-h-[300px] py-1">
            {loading ? (
              <p className="px-3 py-4 text-center text-[13px] text-[color:var(--nimi-text-muted)]">
                {t('agent.loadingAgents')}
              </p>
            ) : agents.length === 0 ? (
              <p className="px-3 py-4 text-center text-[13px] text-[color:var(--nimi-text-muted)]">
                {t('agent.noAgentsAvailable')}
              </p>
            ) : (
              agents.map((a) => {
                const selected = agent?.id === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => handleSelect(a)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-[var(--nimi-motion-fast)] ${
                      selected
                        ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]'
                        : 'hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_4%,transparent)]'
                    }`}
                  >
                    <AgentAvatar agent={a} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[13px] ${selected ? 'font-semibold' : 'font-medium'} text-[color:var(--nimi-text-primary)]`}>
                        {a.name}
                      </p>
                      {a.handle && (
                        <p className="truncate text-[11px] text-[color:var(--nimi-text-muted)]">@{a.handle}</p>
                      )}
                    </div>
                    {selected ? (
                      <Check size={16} className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
                    ) : null}
                  </button>
                );
              })
            )}
          </ScrollArea>
          {/* Clear Agent action */}
          {agent && (
            <div className="border-t border-[color:var(--nimi-border-subtle)]">
              <button
                onClick={handleClear}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-text-secondary transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_4%,transparent)] hover:text-text-primary"
              >
                <X size={14} />
                <span>{t('agent.clearAgent', 'Clear Agent')}</span>
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AgentAvatar({ agent, size }: { agent: Agent; size: number }) {
  if (agent.avatarUrl) {
    return (
      <img
        src={agent.avatarUrl}
        alt={agent.name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_15%,transparent)] font-semibold text-[var(--nimi-action-primary-bg)]"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {agent.name.charAt(0).toUpperCase()}
    </div>
  );
}


// RL-BOOT-004: Runtime unavailable with retry affordance
function RuntimeUnavailable({ onRetry, feature }: { onRetry: () => void; feature: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="text-[17px] font-medium mb-2 text-text-primary">{t('degradation.runtimeUnavailable')}</p>
        <p className="text-[13px] text-text-secondary mb-4">{t('degradation.featureRequiresRuntime', { feature })}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-bg-elevated text-text-primary rounded-xl text-[13px] hover:bg-bg-surface transition-colors duration-150"
        >
          {t('degradation.retryConnection')}
        </button>
      </div>
    </div>
  );
}
