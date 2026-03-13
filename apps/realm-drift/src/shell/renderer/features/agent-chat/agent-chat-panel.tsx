import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { WorldAgent, WorldDetailWithAgents } from '../world-browser/world-browser-data.js';
import { AgentList } from './agent-list.js';
import { streamAgentChat } from './chat-stream.js';
import { generateId } from '@renderer/infra/ulid.js';

type AgentChatPanelProps = {
  agents: WorldAgent[];
  world: WorldDetailWithAgents;
};

export function AgentChatPanel({ agents, world }: AgentChatPanelProps) {
  const { t } = useTranslation();
  const activeChat = useAppStore((s) => s.activeChat);
  const setActiveChat = useAppStore((s) => s.setActiveChat);
  const appendChatMessage = useAppStore((s) => s.appendChatMessage);
  const setStreamingState = useAppStore((s) => s.setStreamingState);
  const [inputText, setInputText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedAgent = agents.find((a) => a.id === activeChat?.agentId);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length, activeChat?.partialText]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSelectAgent = useCallback(
    (agent: WorldAgent) => {
      // Abort current stream
      abortRef.current?.abort();
      abortRef.current = null;

      // Switch agent, clear history
      setActiveChat({
        worldId: world.id,
        agentId: agent.id,
        agentName: agent.name,
        messages: [],
        streaming: false,
        partialText: '',
      });
    },
    [setActiveChat],
  );

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !selectedAgent || activeChat?.streaming) return;

    setInputText('');

    // Add user message
    const userMsg = {
      id: generateId(),
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
    };
    appendChatMessage(userMsg);

    // Start streaming
    const ac = new AbortController();
    abortRef.current = ac;
    setStreamingState(true, '');

    void streamAgentChat({
      agent: selectedAgent,
      world,
      messages: activeChat?.messages ?? [],
      userMessage: text,
      signal: ac.signal,
      onDelta: (fullText) => {
        setStreamingState(true, fullText);
      },
      onFinish: (fullText) => {
        setStreamingState(false, '');
        appendChatMessage({
          id: generateId(),
          role: 'assistant',
          content: fullText,
          timestamp: Date.now(),
        });
      },
      onError: () => {
        setStreamingState(false, '');
      },
    });
  }, [inputText, selectedAgent, activeChat?.streaming, world, appendChatMessage, setStreamingState]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // No agent selected — show agent list
  if (!selectedAgent) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-300">{t('viewer.tabAgents')}</h3>
        </div>
        <div className="flex-1 overflow-auto p-2">
          <AgentList
            agents={agents}
            activeAgentId={null}
            onSelect={handleSelectAgent}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Agent header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
        <button
          onClick={() => setActiveChat(null)}
          className="text-neutral-400 hover:text-white text-sm"
        >
          ←
        </button>
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-700 overflow-hidden">
          {selectedAgent.avatarUrl ? (
            <img src={selectedAgent.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
              {selectedAgent.name.charAt(0)}
            </div>
          )}
        </div>
        <span className="text-sm font-medium truncate">{selectedAgent.name}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {activeChat?.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-200'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Streaming partial */}
        {activeChat?.streaming && activeChat.partialText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-neutral-800 text-neutral-200 whitespace-pre-wrap">
              {activeChat.partialText}
              <span className="inline-block w-1 h-4 bg-white/60 animate-pulse ml-0.5" />
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {activeChat?.streaming && !activeChat.partialText && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 bg-neutral-800 text-neutral-400 text-sm">
              {t('chat.streaming')}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-800 p-3">
        <div className="flex gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || activeChat?.streaming}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
          >
            {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
