/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TimeGapDurationDto = {
    /**
     * Whether gap exceeds threshold for synthetic memory
     */
    exceedsThreshold: boolean;
    /**
     * Real time gap formatted (e.g., "2d 5h 30m")
     */
    realGapFormatted: string;
    /**
     * Real time gap in milliseconds
     */
    realGapMs: number;
    /**
     * World time gap formatted
     */
    worldGapFormatted: string;
    /**
     * World time gap in milliseconds
     */
    worldGapMs: number;
};

