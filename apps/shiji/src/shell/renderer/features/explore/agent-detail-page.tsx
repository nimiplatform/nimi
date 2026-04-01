import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ulid } from 'ulid';
import { getAgent } from '@renderer/data/agent-client.js';
import { getCatalogEntry } from '@renderer/data/world-catalog.js';
import { ClassificationBadge } from './components/classification-badge.js';
import { useOnboardingGate } from './onboarding-gate.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  sqliteGetSessionsForLearner,
  sqliteCreateSession,
  sqliteUpdateSession,
} from '@renderer/bridge/sqlite-bridge.js';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type AgentDetailResult = RealmServiceResult<'AgentsService', 'getAgent'>;

export default function AgentDetailPage() {
  const { t } = useTranslation();
  const { worldId, agentId } = useParams<{ worldId: string; agentId: string }>();
  const navigate = useNavigate();
  const { shouldRedirectToProfileCreation } = useOnboardingGate();
  const activeProfile = useAppStore((s) => s.activeProfile);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const catalogEntry = worldId ? getCatalogEntry(worldId) : undefined;

  // Fetch agent detail — SJ-EXPL-006:1
  const { data: agentData, isLoading, error } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      const result = await getAgent(agentId!);
      return result as AgentDetailResult;
    },
    enabled: !!agentId,
  });

  // Check for existing active session — SJ-EXPL-006:6
  const { data: existingSession } = useQuery({
    queryKey: ['active-session', activeProfile?.id, worldId, agentId],
    queryFn: async () => {
      if (!activeProfile || !worldId || !agentId) return null;
      const sessions = await sqliteGetSessionsForLearner(activeProfile.id);
      // Find most recent non-abandoned, non-completed session for this world+agent
      const active = sessions.find(
        (s) => s.worldId === worldId && s.agentId === agentId && s.sessionStatus === 'active'
      );
      return active ?? null;
    },
    enabled: !!activeProfile && !!worldId && !!agentId,
  });

  async function handleStartOrResume() {
    // SJ-SHELL-008:2 — gate dialogue entry on profile existence
    if (shouldRedirectToProfileCreation) {
      navigate('/settings');
      return;
    }

    if (existingSession) {
      // Resume existing session
      navigate(`/session/${existingSession.id}`);
      return;
    }

    if (!catalogEntry || !activeProfile) return;

    setStarting(true);
    setStartError(null);
    try {
      const sessionId = ulid();
      const now = new Date().toISOString();
      await sqliteCreateSession({
        id: sessionId,
        learnerId: activeProfile.id,
        learnerProfileVersion: activeProfile.profileVersion,
        worldId: worldId!,
        agentId: agentId!,
        contentType: catalogEntry.contentType, // SJ-DIAL-008:1 — snapshot classification
        truthMode: catalogEntry.truthMode,
        startedAt: now,
        updatedAt: now,
      });
      navigate(`/session/${sessionId}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '创建会话失败');
      setStarting(false);
    }
  }

  async function handleRestart() {
    if (!existingSession || !catalogEntry || !activeProfile) return;
    setStarting(true);
    setStartError(null);
    try {
      // SJ-DIAL-008:7a — mark old session as ABANDONED
      await sqliteUpdateSession({
        id: existingSession.id,
        sessionStatus: 'abandoned',
        chapterIndex: existingSession.chapterIndex,
        sceneType: existingSession.sceneType,
        rhythmCounter: existingSession.rhythmCounter,
        trunkEventIndex: existingSession.trunkEventIndex,
        updatedAt: new Date().toISOString(),
        completedAt: null,
      });
      // Create fresh session — SJ-DIAL-008:7d
      const sessionId = ulid();
      const now = new Date().toISOString();
      await sqliteCreateSession({
        id: sessionId,
        learnerId: activeProfile.id,
        learnerProfileVersion: activeProfile.profileVersion,
        worldId: worldId!,
        agentId: agentId!,
        contentType: catalogEntry.contentType,
        truthMode: catalogEntry.truthMode,
        startedAt: now,
        updatedAt: now,
      });
      navigate(`/session/${sessionId}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '重新开始失败');
      setStarting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Back link */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-2">
        <Link to={`/explore/${worldId}`} className="text-sm text-neutral-400 hover:text-amber-600 transition-colors flex items-center gap-1">
          <span>←</span>
          <span>{catalogEntry?.displayName ?? '时期详情'}</span>
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
        </div>
      )}

      {error && !isLoading && (
        <div className="flex items-center justify-center h-48">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
        </div>
      )}

      {!isLoading && !error && agentData && (
        <div className="max-w-lg mx-auto px-6 pb-8">
          {/* Agent portrait — SJ-EXPL-006:2 */}
          <div className="flex gap-4 items-start mt-2 mb-6">
            <div className="w-24 h-24 rounded-2xl bg-neutral-100 overflow-hidden shrink-0">
              {agentData.avatarUrl ? (
                <img src={agentData.avatarUrl} alt={agentData.displayName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-neutral-300 text-3xl">人</span>
                </div>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-neutral-900">{agentData.displayName}</h1>
              {catalogEntry && (
                <p className="text-sm text-neutral-500 mt-0.5">{catalogEntry.eraLabel}</p>
              )}
              {/* Classification badge — SJ-EXPL-006:4 */}
              {catalogEntry && (
                <div className="mt-2">
                  <ClassificationBadge contentType={catalogEntry.contentType} truthMode={catalogEntry.truthMode} />
                </div>
              )}
            </div>
          </div>

          {/* Character introduction — SJ-EXPL-006:3 */}
          {agentData.bio && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">人物简介</h2>
              <p className="text-sm text-neutral-600 leading-relaxed">{agentData.bio}</p>
            </div>
          )}

          {/* Existing session banner — SJ-EXPL-006:6 */}
          {existingSession && (
            <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-sm text-amber-800 font-medium">上次对话进行中</p>
              <p className="text-xs text-amber-600 mt-0.5">第 {existingSession.chapterIndex} 章 · 已保存</p>
            </div>
          )}

          {/* Onboarding gate notice — SJ-SHELL-008 */}
          {shouldRedirectToProfileCreation && (
            <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-sm text-amber-800">{t('onboarding.subtitle')}</p>
            </div>
          )}

          {startError && (
            <div className="mb-4 p-3 bg-red-50 rounded-xl border border-red-200">
              <p className="text-xs text-red-600">{startError}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => void handleStartOrResume()}
              disabled={starting}
              className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {starting ? '…' : existingSession ? t('session.resume') : t('session.start')}
            </button>
            {existingSession && (
              <button
                onClick={() => void handleRestart()}
                disabled={starting}
                className="px-4 py-3 bg-white border border-neutral-200 text-neutral-600 rounded-xl font-medium hover:bg-neutral-50 disabled:opacity-50 transition-colors text-sm"
              >
                {t('session.restart')}
              </button>
            )}
          </div>

          {shouldRedirectToProfileCreation && (
            <p className="text-xs text-neutral-400 text-center mt-3">点击"开始对话"后会引导你创建学习者档案</p>
          )}
        </div>
      )}
    </div>
  );
}
