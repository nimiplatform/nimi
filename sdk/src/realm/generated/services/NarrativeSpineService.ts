/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CausalChainDto } from '../models/CausalChainDto';
import type { CreateBranchDto } from '../models/CreateBranchDto';
import type { CreateNarrativeSpineEventDto } from '../models/CreateNarrativeSpineEventDto';
import type { NarrativeSpineBranchDetailDto } from '../models/NarrativeSpineBranchDetailDto';
import type { NarrativeSpineDetailDto } from '../models/NarrativeSpineDetailDto';
import type { NarrativeSpineEventDetailDto } from '../models/NarrativeSpineEventDetailDto';
import type { UpdateNarrativeSpineEventDto } from '../models/UpdateNarrativeSpineEventDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NarrativeSpineService {
    /**
     * Archive a branch (cannot archive CANON)
     * @param branchId Branch ID
     * @returns NarrativeSpineBranchDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerArchiveBranch(
        branchId: string,
    ): CancelablePromise<NarrativeSpineBranchDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/spine/branches/{branchId}/archive',
            path: {
                'branchId': branchId,
            },
        });
    }
    /**
     * Merge a WHATIF branch into a target branch
     * @param targetBranchId Target branch ID
     * @param branchId Source branch ID
     * @returns NarrativeSpineBranchDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerMergeBranch(
        targetBranchId: string,
        branchId: string,
    ): CancelablePromise<NarrativeSpineBranchDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/spine/branches/{branchId}/merge/{targetBranchId}',
            path: {
                'targetBranchId': targetBranchId,
                'branchId': branchId,
            },
        });
    }
    /**
     * Get narrative spine by ID
     * @param spineId Spine ID
     * @returns NarrativeSpineDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetSpine(
        spineId: string,
    ): CancelablePromise<NarrativeSpineDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/by-id/{spineId}',
            path: {
                'spineId': spineId,
            },
        });
    }
    /**
     * List branches for a narrative spine
     * @param spineId Spine ID
     * @returns NarrativeSpineBranchDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetBranches(
        spineId: string,
    ): CancelablePromise<Array<NarrativeSpineBranchDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/by-id/{spineId}/branches',
            path: {
                'spineId': spineId,
            },
        });
    }
    /**
     * Create a new branch (fork from event)
     * @param spineId Spine ID
     * @param requestBody
     * @returns NarrativeSpineBranchDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerCreateBranch(
        spineId: string,
        requestBody: CreateBranchDto,
    ): CancelablePromise<NarrativeSpineBranchDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/spine/by-id/{spineId}/branches',
            path: {
                'spineId': spineId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get default (CANON) branch for a narrative spine
     * @param spineId Spine ID
     * @returns NarrativeSpineBranchDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetDefaultBranch(
        spineId: string,
    ): CancelablePromise<NarrativeSpineBranchDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/by-id/{spineId}/branches/default',
            path: {
                'spineId': spineId,
            },
        });
    }
    /**
     * Append an event to a narrative spine branch
     * @param branchId Branch ID
     * @param spineId Spine ID
     * @param requestBody
     * @returns NarrativeSpineEventDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerAppendEvent(
        branchId: string,
        spineId: string,
        requestBody: CreateNarrativeSpineEventDto,
    ): CancelablePromise<NarrativeSpineEventDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/spine/by-id/{spineId}/branches/{branchId}/events',
            path: {
                'branchId': branchId,
                'spineId': spineId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List narrative spine events
     * @param spineId Spine ID
     * @returns NarrativeSpineEventDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetEvents(
        spineId: string,
    ): CancelablePromise<Array<NarrativeSpineEventDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/by-id/{spineId}/events',
            path: {
                'spineId': spineId,
            },
        });
    }
    /**
     * Find existing narrative spine for a world/user/agent trio
     * @param agentId Agent ID
     * @param worldId World ID
     * @returns NarrativeSpineDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerFindSpine(
        agentId: string,
        worldId: string,
    ): CancelablePromise<NarrativeSpineDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/by-world/{worldId}/by-agent/{agentId}',
            path: {
                'agentId': agentId,
                'worldId': worldId,
            },
        });
    }
    /**
     * Get or create narrative spine for a world/user/agent trio
     * @param agentId Agent ID
     * @param worldId World ID
     * @returns NarrativeSpineDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetOrCreateSpine(
        agentId: string,
        worldId: string,
    ): CancelablePromise<NarrativeSpineDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/spine/by-world/{worldId}/by-agent/{agentId}',
            path: {
                'agentId': agentId,
                'worldId': worldId,
            },
        });
    }
    /**
     * Get a specific narrative spine event
     * @param eventId Event ID
     * @returns NarrativeSpineEventDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetEvent(
        eventId: string,
    ): CancelablePromise<NarrativeSpineEventDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/events/{eventId}',
            path: {
                'eventId': eventId,
            },
        });
    }
    /**
     * Update a narrative spine event
     * @param eventId Event ID
     * @param requestBody
     * @returns NarrativeSpineEventDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerUpdateEvent(
        eventId: string,
        requestBody: UpdateNarrativeSpineEventDto,
    ): CancelablePromise<NarrativeSpineEventDetailDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/world/spine/events/{eventId}',
            path: {
                'eventId': eventId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get causal chain for an event
     * @param eventId Event ID
     * @param depth
     * @returns CausalChainDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetCausalChain(
        eventId: string,
        depth?: number,
    ): CancelablePromise<CausalChainDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/events/{eventId}/causal-chain',
            path: {
                'eventId': eventId,
            },
            query: {
                'depth': depth,
            },
        });
    }
    /**
     * Get child events of an event
     * @param eventId Event ID
     * @returns NarrativeSpineEventDetailDto
     * @throws ApiError
     */
    public static narrativeSpineControllerGetEventChildren(
        eventId: string,
    ): CancelablePromise<Array<NarrativeSpineEventDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/spine/events/{eventId}/children',
            path: {
                'eventId': eventId,
            },
        });
    }
}
