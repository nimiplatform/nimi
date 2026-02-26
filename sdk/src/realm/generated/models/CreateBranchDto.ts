/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateBranchDto = {
    branchType?: CreateBranchDto.branchType;
    description?: string;
    /**
     * Event ID where branch forks
     */
    forkEventId: string;
    forkReason?: string;
};
export namespace CreateBranchDto {
    export enum branchType {
        CANON = 'CANON',
        WHATIF = 'WHATIF',
    }
}

