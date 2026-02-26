/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentOwnershipType } from './AgentOwnershipType';
import type { AgentState } from './AgentState';
export type AgentProfileDto = {
    dna?: Record<string, any>;
    dnaConfirmedAt?: string | null;
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
     * Agent current residence worldId
     */
    worldId?: string;
};

