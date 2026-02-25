/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type EligibilityDto = {
    /**
     * Whether user can create invite codes
     */
    eligible: boolean;
    /**
     * Reason if not eligible
     */
    reason?: string;
    /**
     * Minimum tier required
     */
    requiredTier: number;
};

