// Chat page — Beat-first AI chat
// RL-PIPE-001 + RL-FEAT-003/004 voice

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Settings, Check } from 'lucide-react';
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
import { usePipelineChat } from './hooks/use-pipeline-chat.js';
import { ChatView } from './components/chat-view.js';
import { MessageInput } from './components/message-input.js';
import { EmptyState } from './components/empty-state.js';
import { VoiceControls } from '../voice/components/voice-controls.js';
import { useAppStore, type Agent } from '../../app-shell/providers/app-store.js';
import { getBridge } from '../../bridge/electron-bridge.js';
import { useAgentProfile } from '../agent/hooks/use-agent-profile.js';
import { createBridgeRouteDataProvider } from '../model-config/bridge-route-provider.js';
import { useRelayRoute } from '../model-config/use-relay-route.js';
import {
  useRouteModelPickerData,
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker/headless';
import { CompactRouteModelPicker } from '@nimiplatform/nimi-kit/features/model-picker/ui';

export function ChatPage() {
  const { t } = useTranslation();
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const setDetailMode = useAppStore((s) => s.setDetailMode);
  const [composerHeight, setComposerHeight] = useState(160);
  const composerResizingRef = useRef(false);
  const chatLayoutRef = useRef<HTMLDivElement>(null);

  const ai = usePipelineChat();

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

  // RL-CORE-001: No agent selected
  // No agent — show inline agent picker (fallback if bootstrap auto-select failed)
  if (!currentAgent) {
    return <NoAgentFallback />;
  }

  return (
    <div ref={chatLayoutRef} className="flex flex-col h-full">
      {/* Header — agent avatar+name (dropdown) + settings */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <AgentSwitcher agent={currentAgent} />
        <button
          onClick={() => setDetailMode('settings')}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
          title={t('settings.title', 'Settings')}
        >
          <Settings size={17} />
        </button>
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
              agentName={currentAgent.name}
              onQuickAction={(prompt) => ai.sendMessage(prompt)}
            />
          ) : (
            <ChatView messages={ai.messages} sendPhase={ai.sendPhase} />
          )}
          <ChatComposerResizeHandle onMouseDown={startComposerResize} />
          <ChatComposerShell height={composerHeight}>
            <MessageInput
              onSend={ai.sendMessage}
              disabled={!ai.canChat || ai.isSending}
              placeholder={t('chat.messageAgent', { name: currentAgent.name })}
              isSending={ai.isSending}
              sendPhase={ai.sendPhase}
              onCancelTurn={() => ai.cancelTurn()}
              modelPickerSlot={<ChatModelPicker />}
              toolbar={
                <VoiceControls
                  onTranscript={handleTranscript}
                  lastAssistantText={lastAssistantText}
                />
              }
            />
          </ChatComposerShell>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentSwitcher — avatar + name dropdown to switch agents
// ---------------------------------------------------------------------------

function AgentSwitcher({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { fetchAgentList, selectAgent } = useAgentProfile();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_5%,transparent)]">
          <AgentAvatar agent={agent} size={28} />
          <span className="text-[14px] font-medium text-[color:var(--nimi-text-primary)]">{agent.name}</span>
          <ChevronDown size={14} className="text-[color:var(--nimi-text-muted)]" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" sideOffset={4} className="w-[280px] p-0">
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
                const selected = agent.id === a.id;
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

// ---------------------------------------------------------------------------
// ChatModelPicker — inline compact model picker using kit component
// ---------------------------------------------------------------------------

/**
 * Extracts a clean display name from a model ID.
 * "local/local-import/Qwen3-4B-Q4_K_M" -> "Qwen3-4B-Q4_K_M"
 */
function formatModelDisplayName(raw: string): string {
  const parts = raw.split('/');
  return parts.length > 1 ? parts[parts.length - 1]! : raw;
}

function ChatModelPicker() {
  const { t } = useTranslation();
  const {
    binding,
    snapshot,
    display,
    options,
    loading: routeLoading,
  } = useRelayRoute();

  const provider = useMemo<RouteModelPickerDataProvider>(() => createBridgeRouteDataProvider(), []);

  const initialSelection = useMemo<RouteModelPickerSelection>(() => {
    const source = display?.source ?? binding?.source ?? 'local';
    if (source === 'cloud') {
      return {
        source,
        connectorId: display?.connectorId ?? binding?.connectorId ?? snapshot?.connectorId ?? '',
        model: display?.model ?? binding?.model ?? '',
      };
    }

    const selectedLocalModelId = snapshot?.localModelId
      ?? binding?.localModelId
      ?? options?.local.models.find((item) => (
        item.modelId === display?.model || item.localModelId === display?.model
      ))?.localModelId
      ?? '';

    return {
      source,
      connectorId: '',
      model: selectedLocalModelId,
    };
  }, [binding, display, options?.local.models, snapshot]);

  const handleSelectionChange = useCallback((selection: RouteModelPickerSelection) => {
    const bridge = getBridge();
    if (selection.source === 'local') {
      void bridge.route.setBinding({
        source: 'local',
        model: selection.model || undefined,
        localModelId: selection.model || undefined,
      });
      return;
    }
    void bridge.route.setBinding({
      source: 'cloud',
      connectorId: selection.connectorId || undefined,
      model: selection.model || undefined,
    });
  }, []);

  const labels = useMemo(() => ({
    source: t('route.source', 'Source'),
    local: t('route.local', 'Local'),
    cloud: t('route.cloud', 'Cloud'),
    connector: t('route.connector', 'Connector'),
    model: t('route.model', 'Model'),
    active: t('route.active', 'Active'),
    reset: t('route.reset', 'Reset'),
    loading: t('route.loading', 'Loading models...'),
    unavailable: t('route.unavailable', 'Route options unavailable'),
    localUnavailable: t('route.localLoadFailed', 'Local model discovery failed. Runtime may be unavailable.'),
    noLocalModels: t('route.noLocalModels', 'No local models available. Install a model via Desktop.'),
    selectConnector: t('route.selectConnector', 'Select a connector to see available models.'),
    noCloudModels: t('route.noCloudModels', 'No models available for this connector.'),
    savedRouteUnavailable: t('route.fallbackWarning', 'Saved route is no longer available.'),
  }), [t]);

  const {
    selection,
    connectors,
    loading,
    pickerState,
    changeSource,
    changeConnector,
  } = useRouteModelPickerData({
    provider,
    capability: 'text.generate',
    initialSelection,
    onSelectionChange: handleSelectionChange,
    labels,
  });

  if (routeLoading || loading) {
    return null;
  }

  const hasConnectors = connectors.length > 0;
  const connectorOptions = connectors.map((c) => ({
    value: c.connectorId,
    label: `${c.label} (${c.provider})`,
  }));

  // Format the selected model name for the trigger
  const selectedTitle = pickerState.selectedModel
    ? formatModelDisplayName(pickerState.adapter.getTitle(pickerState.selectedModel))
    : undefined;

  return (
    <CompactRouteModelPicker
      state={pickerState}
      triggerLabel={selectedTitle}
      sourceValue={selection.source}
      sourceOptions={[
        { value: 'local' as const, label: labels.local },
        { value: 'cloud' as const, label: labels.cloud, disabled: !hasConnectors },
      ]}
      onSourceChange={changeSource}
      showConnector={selection.source === 'cloud' && hasConnectors}
      connectorValue={selection.connectorId}
      connectorOptions={connectorOptions}
      onConnectorChange={changeConnector}
      loading={loading}
      loadingMessage={labels.loading}
      emptyMessage={selection.source === 'local' ? labels.noLocalModels : labels.noCloudModels}
      side="top"
      align="start"
    />
  );
}

// ---------------------------------------------------------------------------
// NoAgentFallback — inline agent list when bootstrap auto-select failed
// ---------------------------------------------------------------------------

function NoAgentFallback() {
  const { t } = useTranslation();
  const { fetchAgentList, selectAgent } = useAgentProfile();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAgentList()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [fetchAgentList]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-[320px]">
        <h2 className="mb-1 text-center text-[17px] font-semibold text-text-primary">
          {t('agent.noAgentSelected')}
        </h2>
        <p className="mb-5 text-center text-[13px] text-text-secondary">
          {t('agent.selectToStart', 'Select an agent to start chatting')}
        </p>

        {loading ? (
          <p className="text-center text-[13px] text-text-secondary">{t('agent.loadingAgents')}</p>
        ) : agents.length === 0 ? (
          <p className="text-center text-[13px] text-text-secondary">{t('agent.noAgentsAvailable')}</p>
        ) : (
          <div className="space-y-0.5 rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-overlay)] p-1">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => selectAgent(a)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_4%,transparent)]"
              >
                <AgentAvatar agent={a} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[color:var(--nimi-text-primary)]">{a.name}</p>
                  {a.handle && (
                    <p className="truncate text-[11px] text-[color:var(--nimi-text-muted)]">@{a.handle}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
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
