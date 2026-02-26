/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldEventGraphSummaryDto } from './WorldEventGraphSummaryDto';
import type { WorldLorebookDetailDto } from './WorldLorebookDetailDto';
import type { WorldPatchDto } from './WorldPatchDto';
import type { WorldviewPatchDto } from './WorldviewPatchDto';
export type WorldMaintenanceDto = {
    editorSnapshotVersion?: string;
    eventSummary?: WorldEventGraphSummaryDto;
    lorebooks: Array<WorldLorebookDetailDto>;
    world: WorldPatchDto;
    worldview?: WorldviewPatchDto;
};

