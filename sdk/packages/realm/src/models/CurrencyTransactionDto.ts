/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CurrencyTransactionDto = {
    /**
     * Transaction amount (+/-)
     */
    amount: string;
    /**
     * Balance after transaction
     */
    balanceAfter: string;
    createdAt: string;
    /**
     * Currency type (SPARK or GEM)
     */
    currencyType: string;
    description?: string | null;
    id: string;
    referenceId?: string | null;
    /**
     * Transaction type
     */
    type: string;
};

