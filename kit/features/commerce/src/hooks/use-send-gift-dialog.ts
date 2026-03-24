import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommerceGiftAdapter, CommerceGiftCatalogItem } from '../types.js';

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function parseSparkCost(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function toGiftCatalogItem(value: unknown): CommerceGiftCatalogItem | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const id = String(record.id || '').trim();
  if (!id) {
    return null;
  }
  const sparkCost = parseSparkCost(record.sparkCost);
  if (sparkCost == null) {
    return null;
  }
  const name = String(record.name || id).trim() || id;
  const emoji = String(record.emoji || '').trim() || '🎁';
  const iconUrl = String(record.iconUrl || '').trim() || null;
  return {
    id,
    name,
    emoji,
    iconUrl,
    sparkCost,
  };
}

export function normalizeCommerceGiftCatalog(input: unknown): CommerceGiftCatalogItem[] {
  const root = toRecord(input);
  const rawItems = Array.isArray(input)
    ? input
    : (Array.isArray(root?.items) ? root.items : []);
  return rawItems
    .map((item) => toGiftCatalogItem(item))
    .filter((item): item is CommerceGiftCatalogItem => Boolean(item));
}

export function resolveSelectedGiftId(
  items: readonly CommerceGiftCatalogItem[],
  currentId: string,
): string {
  const normalizedCurrentId = String(currentId || '').trim();
  if (normalizedCurrentId && items.some((item) => item.id === normalizedCurrentId)) {
    return normalizedCurrentId;
  }
  return items[0]?.id || '';
}

export type UseSendGiftDialogOptions = {
  open: boolean;
  receiverId: string;
  adapter: CommerceGiftAdapter;
  onSent?: () => void;
};

export type UseSendGiftDialogResult = {
  giftOptions: readonly CommerceGiftCatalogItem[];
  selectedGiftId: string;
  selectedGift: CommerceGiftCatalogItem | null;
  message: string;
  sending: boolean;
  error: string | null;
  catalogLoading: boolean;
  catalogError: string | null;
  isCatalogEmpty: boolean;
  canSend: boolean;
  setSelectedGiftId: (value: string) => void;
  setMessage: (value: string) => void;
  refreshCatalog: () => Promise<void>;
  handleSend: () => Promise<boolean>;
  clearError: () => void;
};

export function useSendGiftDialog({
  open,
  receiverId,
  adapter,
  onSent,
}: UseSendGiftDialogOptions): UseSendGiftDialogResult {
  const [giftOptions, setGiftOptions] = useState<readonly CommerceGiftCatalogItem[]>([]);
  const [selectedGiftId, setSelectedGiftId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const refreshCatalog = useCallback(async () => {
    if (!open) {
      return;
    }
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const nextItems = await adapter.listGiftCatalog();
      setGiftOptions(nextItems);
    } catch (nextError) {
      setGiftOptions([]);
      setCatalogError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setCatalogLoading(false);
    }
  }, [adapter, open]);

  useEffect(() => {
    if (!open) {
      setSelectedGiftId('');
      setMessage('');
      setSending(false);
      sendingRef.current = false;
      setError(null);
      setCatalogError(null);
      return;
    }
    void refreshCatalog();
  }, [open, refreshCatalog]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedGiftId((currentId) => resolveSelectedGiftId(giftOptions, currentId));
  }, [giftOptions, open]);

  const selectedGift = giftOptions.find((item) => item.id === selectedGiftId) || null;
  const isCatalogEmpty = !catalogLoading && !catalogError && giftOptions.length === 0;
  const canSend = Boolean(selectedGift && !catalogLoading && !catalogError && !isCatalogEmpty && !sending && receiverId.trim());

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (sendingRef.current || !selectedGiftId || !receiverId.trim()) {
      return false;
    }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await adapter.sendGift({
        receiverId: receiverId.trim(),
        giftId: selectedGiftId,
        message: message.trim() || undefined,
      });
      onSent?.();
      return true;
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [adapter, message, onSent, receiverId, selectedGiftId]);

  return {
    giftOptions,
    selectedGiftId,
    selectedGift,
    message,
    sending,
    error,
    catalogLoading,
    catalogError,
    isCatalogEmpty,
    canSend,
    setSelectedGiftId,
    setMessage,
    refreshCatalog,
    handleSend,
    clearError,
  };
}
