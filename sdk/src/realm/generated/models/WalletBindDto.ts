/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WalletBindDto = {
    /**
     * Chain ID
     */
    chainId?: number;
    /**
     * Message that was signed
     */
    message?: string;
    /**
     * Signature to verify ownership
     */
    signature: string;
    /**
     * Wallet address to bind
     */
    walletAddress: string;
    /**
     * Wallet type (metamask, okx, etc.)
     */
    walletType?: string;
};

