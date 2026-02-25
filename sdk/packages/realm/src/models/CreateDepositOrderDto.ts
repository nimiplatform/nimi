/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateDepositOrderDto = {
    chainId?: number;
    /**
     * Energy to credit
     */
    energyAmount: number;
    paymentMethod: string;
    tokenAddress?: string;
    tokenAmount?: string;
    /**
     * Amount in USD
     */
    usdAmount: number;
};

