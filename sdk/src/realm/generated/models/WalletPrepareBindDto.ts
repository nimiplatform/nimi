/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WalletPrepareBindDto = {
    /**
     * Chain ID
     */
    chainId?: number;
    /**
     * Chain Namespace (eip155, solana, etc.)
     */
    chainNamespace?: string;
    /**
     * Wallet address to prepare bind for
     */
    walletAddress: string;
};

