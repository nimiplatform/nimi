/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserLiteDto } from '../models/UserLiteDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CreatorService {
    /**
     * List Created Agents
     * @returns UserLiteDto
     * @throws ApiError
     */
    public static creatorControllerListAgents(): CancelablePromise<Array<UserLiteDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/creator/agents',
        });
    }
    /**
     * Create a new AI Agent
     * @param requestBody
     * @returns UserLiteDto
     * @throws ApiError
     */
    public static creatorControllerCreateAgent(
        requestBody: {
            avatarUrl?: string | null;
            bio?: string;
            displayName: string;
            dna?: Record<string, any>;
            handle: string;
        },
    ): CancelablePromise<UserLiteDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/agents',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Batch create AI Agents
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static creatorControllerBatchCreateAgents(
        requestBody: {
            continueOnError?: boolean;
            items: Array<Record<string, any>>;
        },
    ): CancelablePromise<{
        created?: Array<Record<string, any>>;
        failed?: Array<Record<string, any>>;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/agents/batch-create',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List API Keys (creator scope)
     * @returns any
     * @throws ApiError
     */
    public static creatorControllerListKeys(): CancelablePromise<Array<{
        createdAt?: string;
        id?: string;
        isActive?: boolean;
        label?: string;
        lastUsedAt?: string | null;
        scopes?: Array<string>;
        type?: string;
    }>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/creator/keys',
        });
    }
    /**
     * Create API Key
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static creatorControllerCreateKey(
        requestBody: {
            label: string;
            scopes?: Array<string>;
            type?: 'PERSONAL' | 'SERVICE';
        },
    ): CancelablePromise<{
        createdAt?: string;
        id?: string;
        label?: string;
        token?: string;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/keys',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Revoke API Key
     * @param id API Key ID
     * @returns any API Key revoked
     * @throws ApiError
     */
    public static creatorControllerRevokeKey(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/creator/keys/{id}',
            path: {
                'id': id,
            },
        });
    }
}
