/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldMutationSummaryDto = {
    createdAt: string;
    creatorId: string;
    id: string;
    mutationType: WorldMutationSummaryDto.mutationType;
    reason?: string;
    targetPath: string;
    worldId: string;
};
export namespace WorldMutationSummaryDto {
    export enum mutationType {
        SETTING_CHANGE = 'SETTING_CHANGE',
        RULE_UPDATE = 'RULE_UPDATE',
        LOREBOOK_OVERRIDE = 'LOREBOOK_OVERRIDE',
        TABOO_CHANGE = 'TABOO_CHANGE',
        LOCATION_CHANGE = 'LOCATION_CHANGE',
        EVENT_CREATE = 'EVENT_CREATE',
        EVENT_UPDATE = 'EVENT_UPDATE',
        EVENT_DELETE = 'EVENT_DELETE',
        EVENT_BATCH_UPSERT = 'EVENT_BATCH_UPSERT',
    }
}

