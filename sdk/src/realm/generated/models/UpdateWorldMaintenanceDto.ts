/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldLorebookUpsertDto } from './WorldLorebookUpsertDto';
import type { WorldPatchDto } from './WorldPatchDto';
import type { WorldviewPatchDto } from './WorldviewPatchDto';
export type UpdateWorldMaintenanceDto = {
    ifSnapshotVersion?: string;
    lorebookUpserts?: Array<WorldLorebookUpsertDto>;
    reason?: string;
    worldPatch?: WorldPatchDto;
    worldviewPatch?: WorldviewPatchDto;
};

