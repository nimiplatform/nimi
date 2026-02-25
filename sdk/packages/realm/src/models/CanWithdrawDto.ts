/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StripeConnectStatus } from './StripeConnectStatus';
export type CanWithdrawDto = {
    /**
     * Current Gem balance
     */
    balance: string;
    canWithdraw: boolean;
    connectStatus: StripeConnectStatus;
    /**
     * Minimum withdrawal amount in Gems
     */
    minAmount: string;
    reason?: string | null;
};

