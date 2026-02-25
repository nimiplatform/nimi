/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubscriptionTier } from './SubscriptionTier';
export type SubscriptionTierConfigDto = {
    /**
     * Daily energy quota (-1 for unlimited)
     */
    dailyEnergyQuota: number;
    /**
     * Features included in this tier
     */
    features: Array<string>;
    /**
     * Price in USD per month
     */
    priceUsd: number;
    tier: SubscriptionTier;
};

