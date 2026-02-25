/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentCategory } from './AgentCategory';
import type { AgentOrigin } from './AgentOrigin';
import type { AgentOwnershipType } from './AgentOwnershipType';
import type { AgentState } from './AgentState';
import type { AgentWakeStrategy } from './AgentWakeStrategy';
import type { VerificationTier } from './VerificationTier';
export type AgentMetadataDto = {
    /**
     * Agent category: GENERAL, COMPANION, ASSISTANT, CREATIVE, GAME, EDUCATION, BUSINESS
     */
    category?: AgentCategory;
    isPublic?: boolean;
    /**
     * Agent origin: OFFICIAL, PARTNER, COMMUNITY
     */
    origin?: AgentOrigin;
    /**
     * WORLD_OWNED ownership audit field
     */
    ownerWorldId?: string | null;
    /**
     * Ownership semantics: MASTER_OWNED or WORLD_OWNED
     */
    ownershipType?: AgentOwnershipType;
    /**
     * Lifecycle state: INCUBATING, READY, ACTIVE, SUSPENDED, FAILED
     */
    state?: AgentState;
    /**
     * Verification tier: OFFICIAL, PARTNER, COMMUNITY
     */
    tier?: VerificationTier;
    /**
     * Wake strategy: PASSIVE, PROACTIVE, SCHEDULED
     */
    wakeStrategy?: AgentWakeStrategy;
    /**
     * Agent current residence worldId
     */
    worldId?: string;
};

