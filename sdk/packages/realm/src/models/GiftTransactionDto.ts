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
     * Energy share for agent creator (if receiver is agent)
     */
    creatorShare: string;
    /**
     * Total energy cost paid by sender
     */
    energyCost: string;
    /**
     * Expiration time for unclaimed gifts
     */
    expiresAt: string;
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
     * Energy share for receiver to claim
     */
    receiverShare: string;
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
     * Gift status
     */
    status: GiftStatus;
};

