// Session list hook — subscribes to bridge.chat.onSessions(), groups by date
// RL-PIPE-001: renderer is thin consumer of main-process session state

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import type { LocalChatSession } from '../../../../main/chat-pipeline/types.js';

export type DateGroup = 'today' | 'yesterday' | 'previous7Days' | 'older';

export interface GroupedSessions {
  group: DateGroup;
  sessions: LocalChatSession[];
}

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= sevenDaysAgo) return 'previous7Days';
  return 'older';
}

function groupSessions(sessions: LocalChatSession[]): GroupedSessions[] {
  const groups: Record<DateGroup, LocalChatSession[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };

  for (const session of sessions) {
    const group = getDateGroup(session.updatedAt);
    groups[group].push(session);
  }

  const order: DateGroup[] = ['today', 'yesterday', 'previous7Days', 'older'];
  return order
    .filter((g) => groups[g].length > 0)
    .map((g) => ({ group: g, sessions: groups[g] }));
}

export function useSessionList() {
  const [sessions, setSessions] = useState<LocalChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    try {
      const bridge = getBridge();
      const listenerId = bridge.chat.onSessions((incoming) => {
        setSessions(incoming);
      });
      return () => bridge.chat.removeListener(listenerId);
    } catch {
      // Bridge not available
    }
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const grouped = useMemo(() => groupSessions(filtered), [filtered]);

  const clearSearch = useCallback(() => setSearchQuery(''), []);

  return {
    sessions: filtered,
    grouped,
    searchQuery,
    setSearchQuery,
    clearSearch,
    totalCount: sessions.length,
  };
}
