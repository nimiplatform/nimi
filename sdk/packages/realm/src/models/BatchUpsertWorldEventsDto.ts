/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldEventUpsertDto } from './WorldEventUpsertDto';
export type BatchUpsertWorldEventsDto = {
    eventUpserts: Array<WorldEventUpsertDto>;
    ifSnapshotVersion?: string;
    mode?: BatchUpsertWorldEventsDto.mode;
    reason?: string;
};
export namespace BatchUpsertWorldEventsDto {
    export enum mode {
        MERGE = 'merge',
        REPLACE = 'replace',
    }
}

