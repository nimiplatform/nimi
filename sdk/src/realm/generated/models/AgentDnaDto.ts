/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentAppearanceDto } from './AgentAppearanceDto';
import type { AgentBiologicalDto } from './AgentBiologicalDto';
import type { AgentCommunicationDto } from './AgentCommunicationDto';
import type { AgentIdentityDto } from './AgentIdentityDto';
import type { AgentPersonalityDto } from './AgentPersonalityDto';
import type { AgentVoiceConfigDto } from './AgentVoiceConfigDto';
export type AgentDnaDto = {
    appearance: AgentAppearanceDto;
    biological: AgentBiologicalDto;
    communication: AgentCommunicationDto;
    identity: AgentIdentityDto;
    nsfwLevel?: string;
    personality: AgentPersonalityDto;
    voice?: AgentVoiceConfigDto;
};

