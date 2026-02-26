/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TimeGapDetailDto } from './TimeGapDetailDto';
import type { TimeGapDurationDto } from './TimeGapDurationDto';
export type DetectedGapDto = {
    duration?: TimeGapDurationDto;
    gap?: TimeGapDetailDto;
    /**
     * Whether a gap was detected
     */
    hasGap: boolean;
};

