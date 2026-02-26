/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AggregateMetricsDto } from '../models/AggregateMetricsDto';
import type { ConsensusMetricDetailDto } from '../models/ConsensusMetricDetailDto';
import type { CreateMutationProposalDto } from '../models/CreateMutationProposalDto';
import type { GrowthProjectionDto } from '../models/GrowthProjectionDto';
import type { MutationProposalDetailDto } from '../models/MutationProposalDetailDto';
import type { ReviewProposalDto } from '../models/ReviewProposalDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SoulEvolutionService {
    /**
     * Get growth projection for an agent
     * @param agentId Agent ID
     * @returns GrowthProjectionDto
     * @throws ApiError
     */
    public static soulEvolutionControllerGetGrowthProjection(
        agentId: string,
    ): CancelablePromise<GrowthProjectionDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/soul-evolution/by-agent/{agentId}/growth-projection',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Query consensus metrics for an agent
     * @param agentId Agent ID
     * @returns ConsensusMetricDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerGetMetrics(
        agentId: string,
    ): CancelablePromise<Array<ConsensusMetricDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/soul-evolution/by-agent/{agentId}/metrics',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Aggregate consensus metrics for an agent
     * @param agentId Agent ID
     * @param requestBody
     * @returns ConsensusMetricDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerAggregateMetrics(
        agentId: string,
        requestBody: AggregateMetricsDto,
    ): CancelablePromise<Array<ConsensusMetricDetailDto>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/soul-evolution/by-agent/{agentId}/metrics/aggregate',
            path: {
                'agentId': agentId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get latest consensus metrics for an agent
     * @param agentId Agent ID
     * @returns ConsensusMetricDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerGetLatestMetrics(
        agentId: string,
    ): CancelablePromise<Array<ConsensusMetricDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/soul-evolution/by-agent/{agentId}/metrics/latest',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * List mutation proposals for an agent
     * @param agentId Agent ID
     * @returns MutationProposalDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerGetProposals(
        agentId: string,
    ): CancelablePromise<Array<MutationProposalDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/soul-evolution/by-agent/{agentId}/proposals',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Create a mutation proposal for an agent
     * @param agentId Agent ID
     * @param requestBody
     * @returns MutationProposalDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerCreateProposal(
        agentId: string,
        requestBody: CreateMutationProposalDto,
    ): CancelablePromise<MutationProposalDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/soul-evolution/by-agent/{agentId}/proposals',
            path: {
                'agentId': agentId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List pending mutation proposals for an agent
     * @param agentId Agent ID
     * @returns MutationProposalDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerGetPendingProposals(
        agentId: string,
    ): CancelablePromise<Array<MutationProposalDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/soul-evolution/by-agent/{agentId}/proposals/pending',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Get a specific mutation proposal
     * @param proposalId Proposal ID
     * @returns MutationProposalDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerGetProposal(
        proposalId: string,
    ): CancelablePromise<MutationProposalDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/soul-evolution/proposals/{proposalId}',
            path: {
                'proposalId': proposalId,
            },
        });
    }
    /**
     * Review (approve/reject) a mutation proposal
     * @param proposalId Proposal ID
     * @param requestBody
     * @returns MutationProposalDetailDto
     * @throws ApiError
     */
    public static soulEvolutionControllerReviewProposal(
        proposalId: string,
        requestBody: ReviewProposalDto,
    ): CancelablePromise<MutationProposalDetailDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/world/soul-evolution/proposals/{proposalId}/review',
            path: {
                'proposalId': proposalId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
