/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type MutationProposalDetailDto = {
    agentId: string;
    confidence: number;
    createdAt: string;
    evidenceMetricIds: Array<string>;
    expectedImpact?: string;
    id: string;
    proposedChange: Record<string, any>;
    rejectReason?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    status: MutationProposalDetailDto.status;
};
export namespace MutationProposalDetailDto {
    export enum status {
        PENDING = 'PENDING',
        APPROVED = 'APPROVED',
        REJECTED = 'REJECTED',
    }
}

