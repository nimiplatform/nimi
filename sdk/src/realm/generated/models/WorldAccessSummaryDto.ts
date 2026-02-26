/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldAccessRecordDto } from './WorldAccessRecordDto';
export type WorldAccessSummaryDto = {
    canCreateWorld: boolean;
    canMaintainWorld: boolean;
    hasActiveAccess: boolean;
    records: Array<WorldAccessRecordDto>;
    userId: string;
};

