/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProposedChangeDto } from './ProposedChangeDto';
export type CreateMutationProposalDto = {
    /**
     * Confidence score (0-1)
     */
    confidence: number;
    /**
     * Evidence metric IDs
     */
    evidenceMetricIds: Array<string>;
    expectedImpact?: string;
    proposedChange: Array<ProposedChangeDto>;
};

