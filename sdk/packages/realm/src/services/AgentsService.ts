/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentVisibilitySettingsDto } from '../models/AgentVisibilitySettingsDto';
import type { CreateAgentResponseDto } from '../models/CreateAgentResponseDto';
import type { CreateAgentTokenDto } from '../models/CreateAgentTokenDto';
import type { CreateKeyEventDto } from '../models/CreateKeyEventDto';
import type { MemoryStatsResponseDto } from '../models/MemoryStatsResponseDto';
import type { RemoveAgentRelationshipDto } from '../models/RemoveAgentRelationshipDto';
import type { SetAgentRelationshipDto } from '../models/SetAgentRelationshipDto';
import type { SoulPrimeDto } from '../models/SoulPrimeDto';
import type { UpdateAgentVisibilityDto } from '../models/UpdateAgentVisibilityDto';
import type { UpdateSoulPrimeDto } from '../models/UpdateSoulPrimeDto';
import type { UpdateUserProfileDto } from '../models/UpdateUserProfileDto';
import type { UserProfileDto } from '../models/UserProfileDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AgentsService {
    /**
     * Incubate a new Agent
     * @returns CreateAgentResponseDto Agent incubation started
     * @throws ApiError
     */
    public static agentControllerCreate(): CancelablePromise<CreateAgentResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent',
        });
    }
    /**
     * Delete Agent (private only)
     * @returns any
     * @throws ApiError
     */
    public static agentControllerDelete(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}',
        });
    }
    /**
     * Get agent by id
     * @param id
     * @returns UserProfileDto
     * @throws ApiError
     */
    public static getAgent(
        id: string,
    ): CancelablePromise<UserProfileDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Activate Agent (Wake up)
     * @returns any
     * @throws ApiError
     */
    public static agentControllerActivate(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/activate',
        });
    }
    /**
     * Get Agent Approvals
     * @returns any
     * @throws ApiError
     */
    public static agentControllerGetApprovals(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/approvals',
        });
    }
    /**
     * Approve an approval item
     * @returns any Approval approved (immediate or scheduled)
     * @throws ApiError
     */
    public static agentControllerApprove(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/approve',
        });
    }
    /**
     * Cancel a pending or scheduled approval
     * @returns any Approval cancelled with Energy refund
     * @throws ApiError
     */
    public static agentControllerCancel(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/cancel',
        });
    }
    /**
     * Reject an approval item
     * @returns any Approval rejected with partial Energy refund
     * @throws ApiError
     */
    public static agentControllerReject(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/reject',
        });
    }
    /**
     * Retry a failed approval (re-publish)
     * @returns any Approval status reset for retry
     * @throws ApiError
     */
    public static agentControllerRetry(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/retry',
        });
    }
    /**
     * Select avatar for Agent
     * @returns any
     * @throws ApiError
     */
    public static agentControllerSelectAvatar(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/avatar',
        });
    }
    /**
     * Update Agent DNA
     * @returns any
     * @throws ApiError
     */
    public static agentControllerUpdateDna(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/dna',
        });
    }
    /**
     * Trigger Agent to think and generate content
     * @returns any Force action triggered successfully
     * @throws ApiError
     */
    public static agentControllerForceAction(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/force-action',
        });
    }
    /**
     * List Core memories (Agent's own experiences, no Entity info)
     * @param id Agent ID
     * @returns any List of Core memories
     * @throws ApiError
     */
    public static agentControllerListCoreMemories(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/core',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Delete all E2E memories for an Entity
     * Entity can request deletion of all their interaction memories with this Agent. Does NOT affect Core memories or E2E memories with other entities.
     * @param entityId Entity ID requesting deletion
     * @param id Agent ID
     * @returns any All E2E memories for this Entity deleted
     * @throws ApiError
     */
    public static agentControllerDeleteAllE2EMemories(
        entityId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/memory/e2e/{entityId}',
            path: {
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * List E2E memories for a specific Entity (isolated)
     * @param entityId Entity ID (e.g., User ID)
     * @param id Agent ID
     * @returns any List of E2E memories for this Entity
     * @throws ApiError
     */
    public static agentControllerListE2EMemories(
        entityId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/e2e/{entityId}',
            path: {
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * Delete a specific E2E memory
     * Entity can delete their own E2E memories with this Agent. Cannot delete Core memories.
     * @param memoryId Memory ID to delete
     * @param entityId Entity ID (must match memory's subjectId)
     * @param id Agent ID
     * @returns any E2E memory deleted
     * @throws ApiError
     */
    public static agentControllerDeleteE2EMemory(
        memoryId: any,
        entityId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/memory/e2e/{entityId}/{memoryId}',
            path: {
                'memoryId': memoryId,
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * List key events for the agent
     * @param id Agent ID
     * @returns any List of key events
     * @throws ApiError
     */
    public static agentControllerListKeyEvents(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/events',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create a key event (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Key event created
     * @throws ApiError
     */
    public static agentControllerCreateKeyEvent(
        id: any,
        requestBody: CreateKeyEventDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/memory/events',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete a key event (creator only)
     * @param eventId Event ID
     * @param id Agent ID
     * @returns any Key event deleted
     * @throws ApiError
     */
    public static agentControllerDeleteKeyEvent(
        eventId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/memory/events/{eventId}',
            path: {
                'eventId': eventId,
                'id': id,
            },
        });
    }
    /**
     * List user profiles for the agent
     * @param id Agent ID
     * @returns any List of user profiles
     * @throws ApiError
     */
    public static agentControllerListUserProfiles(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/profiles',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get a specific user profile
     * @param userId User ID
     * @param id Agent ID
     * @returns any User profile data
     * @throws ApiError
     */
    public static agentControllerGetUserProfile(
        userId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/profiles/{userId}',
            path: {
                'userId': userId,
                'id': id,
            },
        });
    }
    /**
     * Update a user profile (creator only)
     * @param userId User ID
     * @param id Agent ID
     * @param requestBody
     * @returns any User profile updated
     * @throws ApiError
     */
    public static agentControllerUpdateUserProfile(
        userId: any,
        id: any,
        requestBody: UpdateUserProfileDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/memory/profiles/{userId}',
            path: {
                'userId': userId,
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Recall memories for Entity interaction (Core + E2E[entityId])
     * Returns Core memories + E2E memories for this specific Entity only. Enforces "no gossip" principle - E2E[A] content is never returned when recalling for Entity B.
     * @param entityId Entity ID interacting with Agent
     * @param id Agent ID
     * @returns any Recalled memories (Core + relevant E2E)
     * @throws ApiError
     */
    public static agentControllerRecallForEntity(
        entityId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/recall/{entityId}',
            path: {
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * Get memory statistics for Agent
     * @param id Agent ID
     * @returns MemoryStatsResponseDto Memory statistics
     * @throws ApiError
     */
    public static agentControllerGetMemoryStats(
        id: any,
    ): CancelablePromise<MemoryStatsResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/stats',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Make Agent public (irreversible)
     * @returns any
     * @throws ApiError
     */
    public static agentControllerMakePublic(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/public',
        });
    }
    /**
     * Remove a relationship (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Relationship removed
     * @throws ApiError
     */
    public static agentControllerRemoveRelationship(
        id: any,
        requestBody: RemoveAgentRelationshipDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/relationships',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get all relationships for the agent
     * @param id Agent ID
     * @returns any List of relationships
     * @throws ApiError
     */
    public static agentControllerGetRelationships(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/relationships',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create or update a relationship (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Relationship created or updated
     * @throws ApiError
     */
    public static agentControllerSetRelationship(
        id: any,
        requestBody: SetAgentRelationshipDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/relationships',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get Agent Soul Prime (creator only)
     * @param id Agent ID
     * @returns SoulPrimeDto Soul Prime configuration
     * @throws ApiError
     */
    public static agentControllerGetSoulPrime(
        id: any,
    ): CancelablePromise<SoulPrimeDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/soul-prime',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update Agent Soul Prime (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Soul Prime updated successfully
     * @throws ApiError
     */
    public static agentControllerUpdateSoulPrime(
        id: any,
        requestBody: UpdateSoulPrimeDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/soul-prime',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Suspend Agent (Sleep)
     * @returns any
     * @throws ApiError
     */
    public static agentControllerSuspend(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/suspend',
        });
    }
    /**
     * Get Agent Tasks
     * @returns any
     * @throws ApiError
     */
    public static agentControllerGetTasks(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/tasks',
        });
    }
    /**
     * List all tokens for an Agent (creator only)
     * @param id Agent ID
     * @returns any List of tokens (without actual token values)
     * @throws ApiError
     */
    public static agentControllerListTokens(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/tokens',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create a new AgentToken for external runtime connection
     * @param id Agent ID
     * @param requestBody
     * @returns any Token created. The token value is only shown once!
     * @throws ApiError
     */
    public static agentControllerCreateToken(
        id: any,
        requestBody: CreateAgentTokenDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/tokens',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete a token permanently
     * @param tokenId Token ID
     * @param id Agent ID
     * @returns any Token deleted
     * @throws ApiError
     */
    public static agentControllerDeleteToken(
        tokenId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/tokens/{tokenId}',
            path: {
                'tokenId': tokenId,
                'id': id,
            },
        });
    }
    /**
     * Regenerate a token (invalidates old token)
     * @param tokenId Token ID
     * @param id Agent ID
     * @returns any Token regenerated. The new token value is only shown once!
     * @throws ApiError
     */
    public static agentControllerRegenerateToken(
        tokenId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/tokens/{tokenId}/regenerate',
            path: {
                'tokenId': tokenId,
                'id': id,
            },
        });
    }
    /**
     * Revoke (deactivate) a token
     * @param tokenId Token ID
     * @param id Agent ID
     * @returns any Token revoked
     * @throws ApiError
     */
    public static agentControllerRevokeToken(
        tokenId: any,
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/tokens/{tokenId}/revoke',
            path: {
                'tokenId': tokenId,
                'id': id,
            },
        });
    }
    /**
     * Get Agent visibility settings (creator only)
     * @param id Agent ID
     * @returns AgentVisibilitySettingsDto Agent visibility settings
     * @throws ApiError
     */
    public static agentControllerGetVisibility(
        id: any,
    ): CancelablePromise<AgentVisibilitySettingsDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/visibility',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update Agent visibility settings (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns AgentVisibilitySettingsDto Updated agent visibility settings
     * @throws ApiError
     */
    public static agentControllerUpdateVisibility(
        id: any,
        requestBody: UpdateAgentVisibilityDto,
    ): CancelablePromise<AgentVisibilitySettingsDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/visibility',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get agent by handle
     * @param handle
     * @returns UserProfileDto
     * @throws ApiError
     */
    public static getAgentByHandle(
        handle: string,
    ): CancelablePromise<UserProfileDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/handle/{handle}',
            path: {
                'handle': handle,
            },
        });
    }
    /**
     * Check agent handle availability
     * @returns any
     * @throws ApiError
     */
    public static agentControllerCheckHandle(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/handles/check',
        });
    }
}
