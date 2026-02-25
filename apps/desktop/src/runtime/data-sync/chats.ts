export type ChatSyncMetrics = {
  loadedCount: number;
  hasMore: boolean;
  cursor: string | null;
};

export function toChatSyncMetrics(input: {
  items?: unknown[];
  hasMore?: boolean;
  cursor?: string | null;
}): ChatSyncMetrics {
  return {
    loadedCount: Array.isArray(input.items) ? input.items.length : 0,
    hasMore: Boolean(input.hasMore),
    cursor: input.cursor ?? null,
  };
}

