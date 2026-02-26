/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TransitCheckpointDto } from './TransitCheckpointDto';
export type TransitSessionDataDto = {
    carriedState?: Record<string, any>;
    checkpoints?: Array<TransitCheckpointDto>;
    endedAt?: string;
    reason?: string;
    startedAt: string;
};

