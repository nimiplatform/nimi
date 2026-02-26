/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GiftStatus } from './GiftStatus';
export type GiftTransactionDto = {
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

