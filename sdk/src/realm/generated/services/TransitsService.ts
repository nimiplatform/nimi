/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddCheckpointDto } from '../models/AddCheckpointDto';
import type { CreateTransitDto } from '../models/CreateTransitDto';
import type { TransitDetailDto } from '../models/TransitDetailDto';
import type { TransitSessionDataDto } from '../models/TransitSessionDataDto';
import type { UpdateSessionDataDto } from '../models/UpdateSessionDataDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TransitsService {
    /**
     * List my transits
     * @param transitType
     * @param status
     * @param agentId
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerListTransits(
        transitType?: any,
        status?: any,
        agentId?: any,
    ): CancelablePromise<Array<TransitDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/transit',
            query: {
                'transitType': transitType,
                'status': status,
                'agentId': agentId,
            },
        });
    }
    /**
     * Create a transit session
     * @param requestBody
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerCreateTransit(
        requestBody: CreateTransitDto,
    ): CancelablePromise<TransitDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/transit',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get active transit for an agent
     * @param agentId Agent ID
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerGetActiveTransit(
        agentId: string,
    ): CancelablePromise<TransitDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/transit/active/{agentId}',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Get transit by ID
     * @param id Transit ID
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerGetTransit(
        id: string,
    ): CancelablePromise<TransitDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/transit/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Abandon a transit session
     * @param id Transit ID
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerAbandon(
        id: string,
    ): CancelablePromise<TransitDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/transit/{id}/abandon',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Add a checkpoint to a transit session
     * @param id Transit ID
     * @param requestBody
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerAddCheckpoint(
        id: string,
        requestBody: AddCheckpointDto,
    ): CancelablePromise<TransitDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/transit/{id}/checkpoints',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Complete a transit session
     * @param id Transit ID
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerComplete(
        id: string,
    ): CancelablePromise<TransitDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/transit/{id}/complete',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update transit session data
     * @param id Transit ID
     * @param requestBody
     * @returns TransitDetailDto
     * @throws ApiError
     */
    public static transitControllerUpdateSession(
        id: string,
        requestBody: UpdateSessionDataDto,
    ): CancelablePromise<TransitDetailDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/world/transit/{id}/session',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Start transit session data
     * @param id Transit ID
     * @returns TransitSessionDataDto
     * @throws ApiError
     */
    public static transitControllerStartSession(
        id: string,
    ): CancelablePromise<TransitSessionDataDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/transit/{id}/session/start',
            path: {
                'id': id,
            },
        });
    }
}
