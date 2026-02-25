/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AgentOriginDto = {
    agentId: string;
    /**
     * Whether Agent is native to the World
     */
    isNative: boolean;
    /**
     * Agent creator (Master) ID
     */
    masterId: string;
    /**
     * World creator ID (null for MAIN world)
     */
    worldCreatorId: string | null;
    /**
     * World ID the Agent belongs to
     */
    worldId: string;
};

