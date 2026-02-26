/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentOwnershipType } from './AgentOwnershipType';
import type { AgentWakeStrategy } from './AgentWakeStrategy';
import type { DnaPrimaryType } from './DnaPrimaryType';
import type { DnaSecondaryTrait } from './DnaSecondaryTrait';
export type CreateAgentDto = {
    concept: string;
    /**
     * Pre-built AgentDna JSON. When provided, skips LLM DNA generation.
     */
    dna?: Record<string, any>;
    /**
     * Primary DNA personality archetype
     */
    dnaPrimary?: DnaPrimaryType;
    /**
     * Secondary DNA traits (max 3 recommended)
     */
    dnaSecondary?: Array<DnaSecondaryTrait>;
    handle: string;
    /**
     * Ownership mode: MASTER_OWNED (default) or WORLD_OWNED
     */
    ownershipType?: AgentOwnershipType;
    referenceImageUrl?: string;
    wakeStrategy?: AgentWakeStrategy;
    /**
     * Required when ownershipType is WORLD_OWNED
     */
    worldId?: string;
};

