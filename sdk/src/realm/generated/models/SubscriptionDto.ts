/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubscriptionTier } from './SubscriptionTier';
import type { SubscriptionTierConfigDto } from './SubscriptionTierConfigDto';
export type SubscriptionDto = {
    /**
     * Whether subscription will cancel at period end
     */
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd?: string | null;
    currentPeriodStart?: string | null;
    id: string;
    /**
     * Subscription status
     */
    status: string;
    tier: SubscriptionTier;
    tierConfig: SubscriptionTierConfigDto;
};

