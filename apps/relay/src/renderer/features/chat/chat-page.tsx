// Chat page — Beat-first AI chat + Human chat + Video generation
// RL-PIPE-001 (pipeline) + RL-FEAT-002 (Human) + RL-FEAT-003/004 voice + RL-FEAT-006 (Video)

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, ChevronDown } from 'lucide-react';
import { usePipelineChat } from './hooks/use-pipeline-chat.js';
import { useHumanChat } from './hooks/use-human-chat.js';
import { useVideoGenerate } from '../video/hooks/use-video-generate.js';
import { ChatView } from './components/chat-view.js';
import { MessageInput } from './components/message-input.js';
import { EmptyState } from './components/empty-state.js';
import { VoiceControls } from '../voice/components/voice-controls.js';
import { VideoPlayer } from '../video/components/video-player.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { getBridge } from '../../bridge/electron-bridge.js';

type ChatMode = 'ai' | 'human' | 'video';

export function ChatPage() {
  const { t } = useTranslation();
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const realtimeConnected = useAppStore((s) => s.realtimeConnected);
  const [mode, setMode] = useState<ChatMode>('ai');
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);

  const ai = usePipelineChat();
  const human = useHumanChat();
  const video = useVideoGenerate();

  const lastAssistantText = ai.messages
    .filter((m) => m.role === 'assistant' && m.kind !== 'streaming' && m.content)
    .at(-1)?.content;

  const handleTranscript = useCallback((text: string) => {
    if (text.trim()) ai.sendMessage(text.trim());
  }, [ai.sendMessage]);

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
  if (!currentAgent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-[17px] font-medium mb-2 text-text-primary">{t('agent.noAgentSelected')}</p>
          <p className="text-[13px] text-text-secondary">{t('agent.selectFromSidebar')}</p>
        </div>
      </div>
    );
  }

  const modeLabels: Record<ChatMode, string> = {
    ai: t('chat.aiChat'),
    human: t('chat.humanChat'),
    video: t('video.tab'),
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thin header — agent name + mode selector + actions */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-border-subtle">
        <span className="text-[13px] font-medium text-text-primary">{currentAgent.name}</span>
        <div className="flex items-center gap-2">
          {/* Mode dropdown */}
          <div className="relative">
            <button
              onClick={() => setModeDropdownOpen(!modeDropdownOpen)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors duration-150"
            >
              {modeLabels[mode]}
              <ChevronDown size={13} />
            </button>
            {modeDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setModeDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-bg-elevated border border-border-subtle rounded-xl shadow-md overflow-hidden z-50 min-w-[120px]">
                  {(['ai', 'human', 'video'] as ChatMode[]).map((m) => {
                    const disabled =
                      (m === 'ai' && !runtimeAvailable) ||
                      (m === 'human' && !realtimeConnected) ||
                      (m === 'video' && !runtimeAvailable);
                    return (
                      <button
                        key={m}
                        onClick={() => { setMode(m); setModeDropdownOpen(false); }}
                        disabled={disabled}
                        className={`w-full text-left px-3 py-2 text-[12px] transition-colors duration-150 ${
                          mode === m
                            ? 'text-accent bg-bg-surface'
                            : disabled
                              ? 'text-text-placeholder cursor-not-allowed'
                              : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface'
                        }`}
                      >
                        {modeLabels[m]}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Clear history */}
          <button
            onClick={ai.clearHistory}
            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors duration-150"
            title={t('chat.clearHistory', 'Clear history')}
          >
            <Trash2 size={15} />
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

      {/* AI Chat mode */}
      {mode === 'ai' && (
        <>
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
              {/* Phase + stop */}
              {(ai.isSending || ai.sendPhase !== 'idle') && (
                <div className="flex items-center gap-2 px-6 py-1">
                  {ai.isSending && (
                    <button
                      onClick={() => ai.cancelTurn()}
                      className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {t('chat.stopGenerating')}
                    </button>
                  )}
                  {ai.sendPhase !== 'idle' && (
                    <span className="text-[10px] text-text-placeholder">
                      {ai.sendPhase.replace(/-/g, ' ')}
                    </span>
                  )}
                </div>
              )}
              <MessageInput
                onSend={ai.sendMessage}
                disabled={!ai.canChat || ai.isSending}
                placeholder={t('chat.messageAgent', { name: currentAgent.name })}
                toolbar={
                  <VoiceControls
                    onTranscript={handleTranscript}
                    lastAssistantText={lastAssistantText}
                  />
                }
              />
            </>
          )}
        </>
      )}

      {/* Human Chat mode */}
      {mode === 'human' && (
        <>
          {!realtimeConnected ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-[17px] font-medium mb-2 text-text-primary">{t('degradation.realtimeDisconnected')}</p>
                <p className="text-[13px] text-text-secondary">{t('degradation.humanChatRequiresSocket')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-[720px] mx-auto px-6 py-6 space-y-3">
                  {human.messages.length === 0 && (
                    <div className="text-center text-text-secondary mt-8">
                      <p className="text-[13px]">{t('chat.noMessages')}</p>
                    </div>
                  )}
                  {human.messages.map((msg) => (
                    <div key={msg.id} className="flex gap-2">
                      <span className="text-[12px] text-accent font-medium shrink-0">
                        {msg.senderName || msg.senderId}
                      </span>
                      <span className="text-[14px] text-text-primary">{msg.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <MessageInput
                onSend={human.sendMessage}
                disabled={!human.canChat}
                placeholder={t('chat.sendMessage')}
              />
            </>
          )}
        </>
      )}

      {/* RL-FEAT-006: Video Generation mode */}
      {mode === 'video' && (
        <>
          {!runtimeAvailable ? (
            <RuntimeUnavailable onRetry={handleRetryRuntime} feature={t('video.tab')} />
          ) : (
            <VideoPanel video={video} agentName={currentAgent.name} />
          )}
        </>
      )}
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

// RL-FEAT-006: Video generation panel
function VideoPanel({
  video,
  agentName,
}: {
  video: ReturnType<typeof useVideoGenerate>;
  agentName: string;
}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || !video.canGenerate) return;
    video.generate(trimmed);
    setPrompt('');
  };

  const videoUrl = video.result?.artifacts
    ?.map((artifact) => artifact.uri || undefined)
    .find(Boolean);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-6 py-6 space-y-4">
          {video.status === 'idle' && (
            <div className="text-center text-text-secondary mt-8">
              <p className="text-[13px]">{t('video.enterPrompt', { name: agentName })}</p>
            </div>
          )}
          {video.status === 'submitting' && (
            <div className="text-center text-text-secondary mt-8">
              <p className="text-[13px]">{t('video.submitting')}</p>
            </div>
          )}
          {video.status === 'processing' && (
            <div className="text-center text-text-secondary mt-8">
              <div className="inline-block w-6 h-6 border-2 border-text-secondary border-t-accent rounded-full animate-spin mb-3" />
              <p className="text-[13px]">{t('video.processing')}</p>
              <button onClick={video.cancel} className="mt-3 text-[11px] text-text-secondary hover:text-text-primary">
                {t('video.cancel')}
              </button>
            </div>
          )}
          {video.status === 'completed' && <VideoPlayer url={videoUrl} />}
          {video.status === 'error' && (
            <div className="text-center text-error mt-8">
              <p className="text-[13px]">{t('video.failed')}</p>
              {video.errorMessage && <p className="text-[11px] mt-1 opacity-70">{video.errorMessage}</p>}
            </div>
          )}
        </div>
      </div>
      <div className="px-6 pb-4 pt-2">
        <div className="flex gap-2 rounded-2xl border border-border-subtle bg-bg-surface p-3 focus-within:border-accent focus-within:shadow-glow transition-all duration-150">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            disabled={video.status === 'submitting' || video.status === 'processing'}
            placeholder={t('video.describeVideo')}
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-placeholder outline-none text-[14px]"
          />
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || !video.canGenerate || video.status === 'submitting' || video.status === 'processing'}
            className="px-4 py-2 bg-accent text-white rounded-xl text-[13px] font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {t('video.generate')}
          </button>
        </div>
      </div>
    </div>
  );
}
