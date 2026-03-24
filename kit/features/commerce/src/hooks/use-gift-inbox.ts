import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CommerceGiftInboxAdapter,
  CommerceGiftStatus,
  CommerceGiftSummary,
  CommerceGiftTransaction,
} from '../types.js';

export type UseGiftInboxOptions = {
  enabled?: boolean;
  currentUserId?: string;
  selectedGiftTransactionId?: string | null;
  adapter: CommerceGiftInboxAdapter;
  limit?: number;
  onActionSuccess?: (kind: 'accept' | 'reject') => void | Promise<void>;
  onError?: (error: unknown, kind: 'list' | 'detail' | 'accept' | 'reject') => void;
};

export type UseGiftInboxResult = {
  items: readonly CommerceGiftSummary[];
  selectedGift: CommerceGiftTransaction | null;
  selectedGiftStatus: CommerceGiftStatus;
  isReceiver: boolean;
  listLoading: boolean;
  detailLoading: boolean;
  listError: string | null;
  detailError: string | null;
  pendingAction: 'accept' | 'reject' | null;
  rejectReason: string;
  setRejectReason: (value: string) => void;
  refreshList: () => Promise<void>;
  refreshDetail: () => Promise<void>;
  handleAccept: () => Promise<void>;
  handleReject: () => Promise<void>;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return String(error || 'Unknown error');
}

export function useGiftInbox({
  enabled = true,
  currentUserId,
  selectedGiftTransactionId,
  adapter,
  limit = 50,
  onActionSuccess,
  onError,
}: UseGiftInboxOptions): UseGiftInboxResult {
  const [items, setItems] = useState<readonly CommerceGiftSummary[]>([]);
  const [selectedGift, setSelectedGift] = useState<CommerceGiftTransaction | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'accept' | 'reject' | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const refreshList = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const nextItems = await adapter.listReceivedGifts(limit);
      setItems(nextItems);
    } catch (error) {
      setItems([]);
      const message = toErrorMessage(error);
      setListError(message);
      onError?.(error, 'list');
    } finally {
      setListLoading(false);
    }
  }, [adapter, enabled, limit, onError]);

  const refreshDetail = useCallback(async () => {
    if (!enabled || !selectedGiftTransactionId) {
      setSelectedGift(null);
      setDetailError(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const nextGift = await adapter.getGiftTransaction(selectedGiftTransactionId);
      setSelectedGift(nextGift);
    } catch (error) {
      setSelectedGift(null);
      const message = toErrorMessage(error);
      setDetailError(message);
      onError?.(error, 'detail');
    } finally {
      setDetailLoading(false);
    }
  }, [adapter, enabled, onError, selectedGiftTransactionId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  const selectedGiftStatus = useMemo<CommerceGiftStatus>(
    () => selectedGift?.status || 'PENDING',
    [selectedGift],
  );

  const isReceiver = useMemo(
    () => Boolean(selectedGift && currentUserId && selectedGift.receiver?.id === currentUserId),
    [currentUserId, selectedGift],
  );

  const handleAccept = useCallback(async () => {
    if (!selectedGiftTransactionId || pendingAction) {
      return;
    }
    setPendingAction('accept');
    try {
      await adapter.acceptGift(selectedGiftTransactionId);
      await Promise.all([refreshList(), refreshDetail()]);
      await onActionSuccess?.('accept');
    } catch (error) {
      onError?.(error, 'accept');
    } finally {
      setPendingAction(null);
    }
  }, [adapter, onActionSuccess, onError, pendingAction, refreshDetail, refreshList, selectedGiftTransactionId]);

  const handleReject = useCallback(async () => {
    if (!selectedGiftTransactionId || pendingAction) {
      return;
    }
    setPendingAction('reject');
    try {
      await adapter.rejectGift(selectedGiftTransactionId, {
        reason: rejectReason.trim() || undefined,
      });
      setRejectReason('');
      await Promise.all([refreshList(), refreshDetail()]);
      await onActionSuccess?.('reject');
    } catch (error) {
      onError?.(error, 'reject');
    } finally {
      setPendingAction(null);
    }
  }, [adapter, onActionSuccess, onError, pendingAction, refreshDetail, refreshList, rejectReason, selectedGiftTransactionId]);

  return {
    items,
    selectedGift,
    selectedGiftStatus,
    isReceiver,
    listLoading,
    detailLoading,
    listError,
    detailError,
    pendingAction,
    rejectReason,
    setRejectReason,
    refreshList,
    refreshDetail,
    handleAccept,
    handleReject,
  };
}
