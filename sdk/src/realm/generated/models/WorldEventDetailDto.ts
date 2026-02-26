/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldEventEvidenceRefDto } from './WorldEventEvidenceRefDto';
export type WorldEventDetailDto = {
    cause?: string;
    characterRefs: Array<string>;
    confidence: number;
    createdAt: string;
    createdBy: string;
    dependsOnEventIds: Array<string>;
    evidenceRefs: Array<WorldEventEvidenceRefDto>;
    id: string;
    level: WorldEventDetailDto.level;
    locationRefs: Array<string>;
    needsEvidence: boolean;
    parentEventId?: string;
    process?: string;
    result?: string;
    summary?: string;
    timeRef?: string;
    title: string;
    updatedAt: string;
    updatedBy: string;
    worldId: string;
};
export namespace WorldEventDetailDto {
    export enum level {
        PRIMARY = 'PRIMARY',
        SECONDARY = 'SECONDARY',
    }
}

