import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  useWorldDetailWithAgentsQuery,
  useWorldviewQuery,
  useWorldScenesQuery,
  useWorldLorebooksQuery,
} from '../world-browser/world-browser-queries.js';
import type { RawWorldContext } from './marble-prompt.js';
import { MarbleViewer } from './marble-viewer.js';
import { AgentChatPanel } from '../agent-chat/agent-chat-panel.js';
import { HumanChatPanel } from '../human-chat/human-chat-panel.js';
import { realtimeConnection } from '../human-chat/realtime-connection.js';
import { getPlatformClient } from '@runtime/platform-client.js';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type ListMyFriendsWithDetailsResult = RealmServiceResult<'MeService', 'listMyFriendsWithDetails'>;

type RightPanelTab = 'agents' | 'people';

export function WorldViewerPage() {
  const { worldId } = useParams<{ worldId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.activeRightPanelTab);
  const setActiveTab = useAppStore((s) => s.setActiveRightPanelTab);
  const setFriendList = useAppStore((s) => s.setFriendList);
  const appendHumanChatMessage = useAppStore((s) => s.appendHumanChatMessage);
  const updateHumanMessage = useAppStore((s) => s.updateHumanMessage);
  const removeHumanMessage = useAppStore((s) => s.removeHumanMessage);
  const clearMarbleJob = useAppStore((s) => s.clearMarbleJob);
  const [quality, setQuality] = useState<'mini' | 'standard'>(() => {
    const env = (import.meta as { env?: Record<string, string> }).env;
    return (env?.VITE_MARBLE_QUALITY === 'standard' ? 'standard' : 'mini') as 'mini' | 'standard';
  });
  const [friendListError, setFriendListError] = useState<string | null>(null);

  // Parallel data fetches
  const worldQuery = useWorldDetailWithAgentsQuery(worldId || '');
  const worldviewQuery = useWorldviewQuery(worldId || '');
  const scenesQuery = useWorldScenesQuery(worldId || '');
  const lorebooksQuery = useWorldLorebooksQuery(worldId || '');

  const worldContext: RawWorldContext | null = useMemo(() => {
    if (!worldQuery.data || !worldviewQuery.data) return null;
    return {
      world: worldQuery.data,
      worldview: worldviewQuery.data,
      scenes: scenesQuery.data ?? [],
      lorebooks: lorebooksQuery.data ?? [],
    };
  }, [worldQuery.data, worldviewQuery.data, scenesQuery.data, lorebooksQuery.data]);

  // Socket.IO connection for human chat
  useEffect(() => {
    const store = useAppStore.getState();
    const defaults = store.runtimeDefaults;
    const token = store.auth.token;

    if (!defaults || !token) return;

    realtimeConnection.connect(
      defaults.realm.realtimeUrl || defaults.realm.realmBaseUrl,
      token,
      {
        onChatEvent: (event) => {
          if (event.chatId && event.content) {
            appendHumanChatMessage(event.chatId, {
              id: event.eventId,
              role: event.senderId === store.auth.user?.id ? 'user' : 'assistant',
              content: event.content,
              timestamp: new Date(event.createdAt).getTime() || Date.now(),
            });
          }
        },
        onMessageEdited: (event) => {
          if (event.chatId && event.eventId && event.content) {
            updateHumanMessage(event.chatId, event.eventId, event.content);
          }
        },
        onMessageRecalled: (event) => {
          if (event.chatId && event.eventId) {
            removeHumanMessage(event.chatId, event.eventId);
          }
        },
        onChatRead: () => {
          // Read receipt — no UI action needed for demo
        },
      },
    );

    // Load friend list
    void loadFriendList();

    return () => {
      realtimeConnection.disconnect();
    };
  }, [appendHumanChatMessage]);

  async function loadFriendList() {
    try {
      const { realm } = getPlatformClient();
      const data: ListMyFriendsWithDetailsResult =
        await realm.services.MeService.listMyFriendsWithDetails(undefined, 100);
      const items = ((data.friends ?? data.items ?? data) as Record<string, unknown>[]);
      if (!Array.isArray(items)) return;

      setFriendList(
        items.map((f) => ({
          userId: String(f.userId || f.id || ''),
          displayName: String(f.displayName || f.name || ''),
          handle: String(f.handle || '') || undefined,
          avatarUrl: String(f.avatarUrl || '') || undefined,
          appContext: String(f.appContext || '') || undefined,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('humanChat.friendListFailed');
      setFriendListError(msg);
    }
  }

  const isLoading = worldQuery.isLoading || worldviewQuery.isLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b border-neutral-800 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          onClick={() => navigate('/')}
          className="text-neutral-400 hover:text-white text-sm transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          ← {t('viewer.back')}
        </button>
        <h1 className="text-sm font-semibold truncate">
          {worldQuery.data?.name ?? '...'}
        </h1>
        <div className="flex-1" />

        {/* Regenerate button */}
        <button
          onClick={() => { if (worldId) clearMarbleJob(worldId); }}
          className="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {t('viewer.regenerate')}
        </button>

        {/* Quality toggle */}
        <div
          className="flex items-center gap-1 text-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => setQuality('mini')}
            className={`rounded px-2 py-1 transition-colors ${
              quality === 'mini' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t('viewer.qualityMini')}
          </button>
          <button
            onClick={() => setQuality('standard')}
            className={`rounded px-2 py-1 transition-colors ${
              quality === 'standard' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t('viewer.qualityStandard')}
          </button>
        </div>
      </div>

      {/* Split pane: 70% viewer | 30% chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left pane: Marble Viewer */}
        <div className="flex-[7] border-r border-neutral-800 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          ) : (
            <MarbleViewer
              worldId={worldId || ''}
              worldName={worldQuery.data?.name ?? ''}
              worldContext={worldContext}
              quality={quality}
            />
          )}
        </div>

        {/* Right pane: Tabbed chat */}
        <div className="flex-[3] flex flex-col min-w-[300px] max-w-[420px]">
          {/* Tab bar */}
          <div className="flex border-b border-neutral-800 flex-shrink-0">
            <TabButton
              active={activeTab === 'agents'}
              onClick={() => setActiveTab('agents')}
              label={t('viewer.tabAgents')}
            />
            <TabButton
              active={activeTab === 'people'}
              onClick={() => setActiveTab('people')}
              label={t('viewer.tabPeople')}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'agents' && worldQuery.data && (
              <AgentChatPanel
                agents={worldQuery.data.agents}
                world={worldQuery.data}
              />
            )}
            {activeTab === 'people' && <HumanChatPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'text-white border-b-2 border-white'
          : 'text-neutral-500 hover:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );
}
