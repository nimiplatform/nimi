/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubscriptionTier } from './SubscriptionTier';
export type SubscriptionTierConfigDto = {
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

