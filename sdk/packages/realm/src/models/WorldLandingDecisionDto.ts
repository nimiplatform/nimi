/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldLandingDecisionDto = {
    reason?: string;
    target: WorldLandingDecisionDto.target;
    worldId?: string;
};
export namespace WorldLandingDecisionDto {
    export enum target {
        NO_ACCESS = 'NO_ACCESS',
        CREATE = 'CREATE',
        MAINTAIN = 'MAINTAIN',
    }
}

