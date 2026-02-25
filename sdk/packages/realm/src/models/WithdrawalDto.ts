/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WithdrawalStatus } from './WithdrawalStatus';
export type WithdrawalDto = {
    completedAt?: string | null;
    createdAt: string;
    failureReason?: string | null;
    /**
     * Fee deducted
     */
    feeAmount: string;
    /**
     * Gem amount withdrawn
     */
    gemAmount: string;
    id: string;
    /**
     * Net amount after fee
     */
    netAmount: string;
    status: WithdrawalStatus;
    /**
     * USD amount
     */
    usdAmount: number;
};

