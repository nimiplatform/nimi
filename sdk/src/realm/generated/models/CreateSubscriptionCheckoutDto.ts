/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SubscriptionTier } from './SubscriptionTier';
export type CreateSubscriptionCheckoutDto = {
    /**
     * URL to redirect on cancel
     */
    cancelUrl: string;
    /**
     * URL to redirect on success
     */
    successUrl: string;
    /**
     * Target tier
     */
    tier: SubscriptionTier;
};

