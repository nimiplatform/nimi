/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DepositStatus } from './DepositStatus';
export type DepositOrderDto = {
    /**
     * Chain ID for crypto deposits
     */
    chainId?: number | null;
    createdAt: string;
    /**
     * Energy amount to credit
     */
    energyAmount: string;
    id: string;
    /**
     * Payment method: CRYPTO, STRIPE, APPLE_IAP, etc.
     */
    paymentMethod: string;
    /**
     * Order status
     */
    status: DepositStatus;
    /**
     * Token contract address for crypto deposits
     */
    tokenAddress?: string | null;
    /**
     * Token amount for crypto deposits
     */
    tokenAmount?: string | null;
    /**
     * Transaction hash for crypto deposits
     */
    txHash?: string | null;
    /**
     * Amount in USD
     */
    usdAmount: number;
};

