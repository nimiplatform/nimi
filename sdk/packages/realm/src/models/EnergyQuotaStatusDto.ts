/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubscriptionTier } from './SubscriptionTier';
export type EnergyQuotaStatusDto = {
    /**
     * Daily quota (-1 for unlimited)
     */
    dailyQuota: number;
    /**
     * Whether quota is unlimited
     */
    isUnlimited: boolean;
    /**
     * Remaining (-1 for unlimited)
     */
    remaining: number;
    /**
     * When quota resets
     */
    resetsAt: string | null;
    tier: SubscriptionTier;
    /**
     * Used today
     */
    used: number;
};

