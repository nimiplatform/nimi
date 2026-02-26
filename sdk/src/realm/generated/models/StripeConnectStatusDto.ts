/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StripeConnectStatus } from './StripeConnectStatus';
export type StripeConnectStatusDto = {
    accountId?: string | null;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
    onboardingUrl?: string | null;
    payoutsEnabled: boolean;
    requiresAction: boolean;
    status: StripeConnectStatus;
};

