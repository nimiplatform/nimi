// Chat page — AI agent chat + Human chat + Video generation with tab switching
// RL-FEAT-001 (AI) + RL-FEAT-002 (Human) + RL-FEAT-003/004 voice integration + RL-FEAT-006 (Video)

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentChat } from './hooks/use-agent-chat.js';
import { useHumanChat } from './hooks/use-human-chat.js';
import { useVideoGenerate } from '../video/hooks/use-video-generate.js';
import { ChatView } from './components/chat-view.js';
import { MessageInput } from './components/message-input.js';
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

  const ai = useAgentChat();
  const human = useHumanChat();
  const video = useVideoGenerate();

  // Get the last completed assistant message for TTS
  const lastAssistantText = ai.messages
    .filter((m) => m.role === 'assistant' && !m.streaming && m.text)
    .at(-1)?.text;

  // STT transcript → send as AI message
  const handleTranscript = useCallback((text: string) => {
    if (text.trim()) ai.sendMessage(text.trim());
  }, [ai.sendMessage]);

  // RL-BOOT-004: Retry runtime health check
  const handleRetryRuntime = useCallback(async () => {
    try {
      const bridge = getBridge();
      await bridge.health();
      useAppStore.getState().setRuntimeAvailable(true);
    } catch {
      // Still unavailable
    }
  }, []);

  // RL-CORE-001: No agent selected → show prompt
  if (!currentAgent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium mb-2">{t('agent.noAgentSelected')}</p>
          <p className="text-sm">{t('agent.selectFromSidebar')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mode tabs */}
      <div className="flex border-b border-gray-800">
        <TabButton
          active={mode === 'ai'}
          onClick={() => setMode('ai')}
          label={t('chat.aiChat')}
          disabled={!runtimeAvailable}
        />
        <TabButton
          active={mode === 'human'}
          onClick={() => setMode('human')}
          label={t('chat.humanChat')}
          disabled={!realtimeConnected}
        />
        <TabButton
          active={mode === 'video'}
          onClick={() => setMode('video')}
          label={t('video.tab')}
          disabled={!runtimeAvailable}
        />
      </div>

      {/* AI Chat mode */}
      {mode === 'ai' && (
        <>
          {!runtimeAvailable ? (
            <RuntimeUnavailable onRetry={handleRetryRuntime} feature={t('chat.aiChat')} />
          ) : (
            <>
              <ChatView messages={ai.messages} />
              <div className="flex items-center gap-2 px-4 py-1">
                {ai.isStreaming && (
                  <button
                    onClick={ai.cancelStream}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    {t('chat.stopGenerating')}
                  </button>
                )}
                <div className="ml-auto">
                  <VoiceControls
                    onTranscript={handleTranscript}
                    lastAssistantText={lastAssistantText}
                  />
                </div>
              </div>
              <MessageInput
                onSend={ai.sendMessage}
                disabled={!ai.canChat || ai.isStreaming}
                placeholder={t('chat.messageAgent', { name: currentAgent.name })}
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
              <div className="text-center text-gray-400">
                <p className="text-lg font-medium mb-2">{t('degradation.realtimeDisconnected')}</p>
                <p className="text-sm">{t('degradation.humanChatRequiresSocket')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {human.messages.length === 0 && (
                  <div className="text-center text-gray-500 mt-8">
                    <p className="text-sm">{t('chat.noMessages')}</p>
                  </div>
                )}
                {human.messages.map((msg) => (
                  <div key={msg.id} className="flex gap-2">
                    <span className="text-xs text-blue-400 font-medium shrink-0">
                      {msg.senderName || msg.senderId}
                    </span>
                    <span className="text-sm text-gray-200">{msg.text}</span>
                  </div>
                ))}
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
      <div className="text-center text-gray-400">
        <p className="text-lg font-medium mb-2">{t('degradation.runtimeUnavailable')}</p>
        <p className="text-sm mb-4">{t('degradation.featureRequiresRuntime', { feature })}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg text-sm hover:bg-gray-600 transition-colors"
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

  // Extract first video artifact URL if available
  const videoUrl = video.result?.artifacts
    ?.map((a) => (a as { url?: string }).url)
    .find(Boolean);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {video.status === 'idle' && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-sm">{t('video.enterPrompt', { name: agentName })}</p>
          </div>
        )}

        {video.status === 'submitting' && (
          <div className="text-center text-gray-400 mt-8">
            <p className="text-sm">{t('video.submitting')}</p>
          </div>
        )}

        {video.status === 'processing' && (
          <div className="text-center text-gray-400 mt-8">
            <div className="inline-block w-6 h-6 border-2 border-gray-500 border-t-blue-500 rounded-full animate-spin mb-3" />
            <p className="text-sm">{t('video.processing')}</p>
            <button
              onClick={video.cancel}
              className="mt-3 text-xs text-gray-500 hover:text-gray-300"
            >
              {t('video.cancel')}
            </button>
          </div>
        )}

        {video.status === 'completed' && (
          <VideoPlayer url={videoUrl} />
        )}

        {video.status === 'error' && (
          <div className="text-center text-red-400 mt-8">
            <p className="text-sm">{t('video.failed')}</p>
          </div>
        )}
      </div>

      <div className="flex gap-2 p-4 border-t border-gray-800">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          disabled={video.status === 'submitting' || video.status === 'processing'}
          placeholder={t('video.describeVideo')}
          className="flex-1 bg-gray-800 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!prompt.trim() || !video.canGenerate || video.status === 'submitting' || video.status === 'processing'}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('video.generate')}
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled && !active}
      className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-500 text-white'
          : 'border-transparent text-gray-500 hover:text-gray-300'
      } ${disabled && !active ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  );
}
