/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type GrowthProjectionDto = {
    /**
     * Calculation timestamp
     */
    calculatedAt: string;
    /**
     * Cache expiration timestamp
     */
    expiresAt: string;
    /**
     * Key growth areas
     */
    growthAreas: Array<string>;
    /**
     * Overall maturity score (0-100)
     */
    maturityScore: number;
    /**
     * Maturity vector X component (experience)
     */
    maturityX: number;
    /**
     * Maturity vector Y component (complexity)
     */
    maturityY: number;
    /**
     * Maturity vector Z component (depth)
     */
    maturityZ: number;
    /**
     * Projected growth trajectory
     */
    trajectory: string;
};

