export type CommerceGiftCatalogItem = {
  id: string;
  name: string;
  emoji: string;
  iconUrl: string | null;
  sparkCost: number;
};

export type CommerceGiftStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'REFUNDED';

export type CommerceGiftRecipient = {
  id: string;
  name: string;
  handle?: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
};

export type CommerceGiftParty = {
  id?: string;
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  isAgent?: boolean;
};

export type CommerceGiftSummary = {
  id: string;
  sparkCost: number;
  gemToReceiver?: number;
  status: CommerceGiftStatus;
  createdAt?: string | null;
  message?: string | null;
  gift?: {
    name?: string | null;
    emoji?: string | null;
  } | null;
  sender?: CommerceGiftParty | null;
  receiver?: CommerceGiftParty | null;
};

export type CommerceGiftTransaction = CommerceGiftSummary & {
  expiresAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
};

export type SendGiftInput = {
  receiverId: string;
  giftId: string;
  message?: string;
};

export interface CommerceGiftAdapter {
  listGiftCatalog: () => Promise<readonly CommerceGiftCatalogItem[]> | readonly CommerceGiftCatalogItem[];
  sendGift: (input: SendGiftInput) => Promise<void> | void;
}

export interface CommerceGiftInboxAdapter {
  listReceivedGifts: (limit?: number) => Promise<readonly CommerceGiftSummary[]> | readonly CommerceGiftSummary[];
  getGiftTransaction: (giftTransactionId: string) => Promise<CommerceGiftTransaction> | CommerceGiftTransaction;
  acceptGift: (giftTransactionId: string) => Promise<void> | void;
  rejectGift: (giftTransactionId: string, input: { reason?: string }) => Promise<void> | void;
}
