/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReviewProposalDto = {
    action: ReviewProposalDto.action;
    reason?: string;
};
export namespace ReviewProposalDto {
    export enum action {
        APPROVED = 'APPROVED',
        REJECTED = 'REJECTED',
    }
}

