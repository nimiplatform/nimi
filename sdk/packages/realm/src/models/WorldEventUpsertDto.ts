/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldEventEvidenceRefInputDto } from './WorldEventEvidenceRefInputDto';
export type WorldEventUpsertDto = {
    cause?: string;
    characterRefs?: Array<string>;
    confidence?: number;
    dependsOnEventIds?: Array<string>;
    evidenceRefs?: Array<WorldEventEvidenceRefInputDto>;
    id?: string;
    level: WorldEventUpsertDto.level;
    locationRefs?: Array<string>;
    needsEvidence?: boolean;
    parentEventId?: string;
    process?: string;
    result?: string;
    summary?: string;
    timeRef?: string;
    title: string;
};
export namespace WorldEventUpsertDto {
    export enum level {
        PRIMARY = 'PRIMARY',
        SECONDARY = 'SECONDARY',
    }
}

