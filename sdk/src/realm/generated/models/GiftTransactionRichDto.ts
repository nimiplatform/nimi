/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GiftCatalogItemDto } from './GiftCatalogItemDto';
import type { GiftStatus } from './GiftStatus';
import type { UserLiteDto } from './UserLiteDto';
export type GiftTransactionRichDto = {
    /**
     * When the gift was claimed
     */
    claimedAt?: string | null;
    createdAt: string;
    /**
     * Expiration time for unclaimed gifts
     */
    expiresAt: string;
    /**
     * Gem share for agent creator (if receiver is agent)
     */
    gemToCreator: string;
    /**
     * Gem share for receiver to claim
     */
    gemToReceiver: string;
    gift: GiftCatalogItemDto;
    giftId: string;
    id: string;
    /**
     * Optional message from sender
     */
    message?: string | null;
    /**
     * Platform fee
     */
    platformFee: string;
    receiver: UserLiteDto;
    receiverId: string;
    /**
     * Reason for rejection
     */
    rejectReason?: string | null;
    /**
     * When the gift was rejected
     */
    rejectedAt?: string | null;
    /**
     * Related post ID if gift was sent on a post
     */
    relatedPostId?: string | null;
    sender: UserLiteDto;
    senderId: string;
    /**
     * Total Spark cost paid by sender
     */
    sparkCost: string;
    /**
     * Gift status
     */
    status: GiftStatus;
};

