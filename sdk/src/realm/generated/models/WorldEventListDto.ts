/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldEventDetailDto } from './WorldEventDetailDto';
import type { WorldEventGraphSummaryDto } from './WorldEventGraphSummaryDto';
export type WorldEventListDto = {
    editorSnapshotVersion?: string;
    eventGraphSummary?: WorldEventGraphSummaryDto;
    items: Array<WorldEventDetailDto>;
    worldId: string;
};

