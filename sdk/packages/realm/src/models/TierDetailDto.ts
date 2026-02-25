/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TierDetailDto = {
    /**
     * Asset tier level (0-4)
     */
    assetTier: number;
    /**
     * Total asset value in USD (on-chain + platform spend)
     */
    assetValue: number;
    /**
     * Influence tier level (0-4)
     */
    influenceTier: number;
    /**
     * Net interaction score (positive reviews - negative reviews)
     */
    interactionScore: number;
    /**
     * Interaction tier level (0-4)
     */
    interactionTier: number;
    /**
     * Total verified social followers
     */
    totalFollowers: number;
    userId: string;
    /**
     * Vitality score (default 1000)
     */
    vitalityScore: number;
};

