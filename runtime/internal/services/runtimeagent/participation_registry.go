package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Runtime Agent Participation registry projections.
//
// Every row below mirrors one admitted row of the kernel tables under
// config/spec-frozen/runtime/tables/ one-to-one:
//
//   - agent-participation-profiles.yaml            (K-AGCORE-074..080)
//   - agent-participation-context-blocks.yaml      (K-AGCORE-081)
//   - agent-participation-external-entry-boundaries.yaml (K-AGCORE-089..091)
//
// The registries are closed (K-AGCORE-063 open_string_axis_values_allowed:
// false, K-AGCORE-074 open_profile_kinds_allowed: false, K-AGCORE-081
// open_context_block_kind_allowed: false). Broadening any row requires a spec
// reopen, never a code-only edit.

// Context block kind ids, verbatim from
// agent-participation-context-blocks.yaml entries (K-AGCORE-081).
const (
	participationBlockRuntimeConversationAnchorRef           = "runtime_conversation_anchor_ref"
	participationBlockRealmGroupThreadRef                    = "realm_group_thread_ref"
	participationBlockTriggerMessageRef                      = "trigger_message_ref"
	participationBlockParticipantProjection                  = "participant_projection"
	participationBlockRecentGroupTranscriptProjection        = "recent_group_transcript_projection"
	participationBlockAgentSlotProjection                    = "agent_slot_projection"
	participationBlockScenarioPackageRef                     = "scenario_package_ref"
	participationBlockScenarioRunRef                         = "scenario_run_ref"
	participationBlockScenarioBranchRef                      = "scenario_branch_ref"
	participationBlockVisibleSceneState                      = "visible_scene_state"
	participationBlockRecentSandboxTranscriptProjection      = "recent_sandbox_transcript_projection"
	participationBlockWorldContextRef                        = "world_context_ref"
	participationBlockWorldEventRef                          = "world_event_ref"
	participationBlockVisibleWorldStateProjection            = "visible_world_state_projection"
	participationBlockRecentWorldTranscriptOrEventProjection = "recent_world_transcript_or_event_projection"
	participationBlockExternalParticipantIdentityRef         = "external_participant_identity_ref"
	participationBlockExternalPayloadRef                     = "external_payload_ref"
	participationBlockGatewayVerdictRef                      = "gateway_verdict_ref"
	participationBlockDomainContextRef                       = "domain_context_ref"
	participationBlockToolOrCapabilityProjection             = "tool_or_capability_projection"
	participationBlockDiagnosticProbeRef                     = "diagnostic_probe_ref"
)

// Profile posture strings, verbatim from agent-participation-profiles.yaml.
const (
	participationPostureReferenceExistingRuntimeAgentService = "reference_existing_runtime_agent_service"
	participationPostureCandidateFirstRealmCommit            = "candidate_first_realm_commit"
	participationPostureFutureConsumerOnly                   = "future_consumer_only"
	participationPostureGatewayVerdictRequired               = "gateway_verdict_required"
	participationPostureDiagnosticOnly                       = "diagnostic_only"
)

// participationProfileRow mirrors one profiles: row of
// agent-participation-profiles.yaml. Axis values are the closed
// agent-participation-axis-model.yaml values (K-AGCORE-063..073).
type participationProfileRow struct {
	kind                      runtimev1.ParticipationProfileKind
	sourceRule                string
	transcriptOwner           runtimev1.ParticipationTranscriptOwner
	identitySource            runtimev1.ParticipationIdentitySource
	additionalIdentitySources []runtimev1.ParticipationIdentitySource
	executionOwner            runtimev1.ParticipationExecutionOwner
	memoryReadScope           runtimev1.ParticipationMemoryReadScope
	memoryWriteDefault        runtimev1.ParticipationMemoryWriteDefault
	capabilityScope           runtimev1.ParticipationCapabilityScope
	inputTrust                runtimev1.ParticipationInputTrust
	additionalInputTrust      []runtimev1.ParticipationInputTrust
	outputDestination         runtimev1.ParticipationOutputDestination
	promotionPosture          runtimev1.ParticipationPromotionPosture
	executionConcurrency      runtimev1.ParticipationExecutionConcurrency
	posture                   string
}

// participationProfileRegistry mirrors agent-participation-profiles.yaml
// profiles: in table order (K-AGCORE-074 closed profile registry).
var participationProfileRegistry = []participationProfileRow{
	{
		// K-AGCORE-075 canonical_agent_chat: references existing
		// RuntimeAgentService authority; never a second canonical chat entry.
		kind:                 runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_CANONICAL_AGENT_CHAT,
		sourceRule:           "K-AGCORE-075",
		transcriptOwner:      runtimev1.ParticipationTranscriptOwner_PARTICIPATION_TRANSCRIPT_OWNER_RUNTIME,
		identitySource:       runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_USER_OWNED_NIMI_AGENT,
		executionOwner:       runtimev1.ParticipationExecutionOwner_PARTICIPATION_EXECUTION_OWNER_RUNTIME,
		memoryReadScope:      runtimev1.ParticipationMemoryReadScope_PARTICIPATION_MEMORY_READ_SCOPE_CANONICAL_OWNER_POLICY,
		memoryWriteDefault:   runtimev1.ParticipationMemoryWriteDefault_PARTICIPATION_MEMORY_WRITE_DEFAULT_CANONICAL_WRITE_ALLOWED,
		capabilityScope:      runtimev1.ParticipationCapabilityScope_PARTICIPATION_CAPABILITY_SCOPE_CANONICAL_AGENT_SCOPE,
		inputTrust:           runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_TRUSTED_USER,
		outputDestination:    runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_CANONICAL_CHAT,
		promotionPosture:     runtimev1.ParticipationPromotionPosture_PARTICIPATION_PROMOTION_POSTURE_EXISTING_CANONICAL_POLICY,
		executionConcurrency: runtimev1.ParticipationExecutionConcurrency_PARTICIPATION_EXECUTION_CONCURRENCY_CANONICAL_CHAT_BUDGET,
		posture:              participationPostureReferenceExistingRuntimeAgentService,
	},
	{
		// K-AGCORE-076 realm_group_source: candidate-first; Realm commit truth
		// stays R-CHAT-* (K-AGCORE-083, K-AGCORE-104).
		kind:                 runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT,
		sourceRule:           "K-AGCORE-076",
		transcriptOwner:      runtimev1.ParticipationTranscriptOwner_PARTICIPATION_TRANSCRIPT_OWNER_REALM,
		identitySource:       runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_USER_OWNED_NIMI_AGENT,
		executionOwner:       runtimev1.ParticipationExecutionOwner_PARTICIPATION_EXECUTION_OWNER_RUNTIME,
		memoryReadScope:      runtimev1.ParticipationMemoryReadScope_PARTICIPATION_MEMORY_READ_SCOPE_DYADIC_PRIVATE_EXCLUDED,
		memoryWriteDefault:   runtimev1.ParticipationMemoryWriteDefault_PARTICIPATION_MEMORY_WRITE_DEFAULT_WRITE_NONE,
		capabilityScope:      runtimev1.ParticipationCapabilityScope_PARTICIPATION_CAPABILITY_SCOPE_PROFILE_LIMITED,
		inputTrust:           runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_UNTRUSTED_MULTI_PARTY_TRANSCRIPT,
		outputDestination:    runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_REALM_GROUP_MESSAGE_CANDIDATE,
		promotionPosture:     runtimev1.ParticipationPromotionPosture_PARTICIPATION_PROMOTION_POSTURE_EXPLICIT_CANDIDATE,
		executionConcurrency: runtimev1.ParticipationExecutionConcurrency_PARTICIPATION_EXECUTION_CONCURRENCY_PER_AGENT_PARTICIPATION_QUEUE,
		posture:              participationPostureCandidateFirstRealmCommit,
	},
	{
		// K-AGCORE-077 scenario_sandbox: future-consumer profile only.
		kind:                 runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_SCENARIO_SANDBOX,
		sourceRule:           "K-AGCORE-077",
		transcriptOwner:      runtimev1.ParticipationTranscriptOwner_PARTICIPATION_TRANSCRIPT_OWNER_SCENARIO_MODULE,
		identitySource:       runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_SANDBOX_PROJECTION,
		executionOwner:       runtimev1.ParticipationExecutionOwner_PARTICIPATION_EXECUTION_OWNER_RUNTIME,
		memoryReadScope:      runtimev1.ParticipationMemoryReadScope_PARTICIPATION_MEMORY_READ_SCOPE_DOMAIN_SHARED_ONLY,
		memoryWriteDefault:   runtimev1.ParticipationMemoryWriteDefault_PARTICIPATION_MEMORY_WRITE_DEFAULT_WRITE_NONE,
		capabilityScope:      runtimev1.ParticipationCapabilityScope_PARTICIPATION_CAPABILITY_SCOPE_DOMAIN_LIMITED,
		inputTrust:           runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_SANDBOX_SCRIPT,
		outputDestination:    runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_SCENARIO_TURN_CANDIDATE,
		promotionPosture:     runtimev1.ParticipationPromotionPosture_PARTICIPATION_PROMOTION_POSTURE_EXPLICIT_CANDIDATE,
		executionConcurrency: runtimev1.ParticipationExecutionConcurrency_PARTICIPATION_EXECUTION_CONCURRENCY_DOMAIN_TRIGGER_QUEUE,
		posture:              participationPostureFutureConsumerOnly,
	},
	{
		// K-AGCORE-078 oasis_world_participation: future-consumer profile only.
		kind:                 runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_OASIS_WORLD_PARTICIPATION,
		sourceRule:           "K-AGCORE-078",
		transcriptOwner:      runtimev1.ParticipationTranscriptOwner_PARTICIPATION_TRANSCRIPT_OWNER_OASIS_WORLD_DOMAIN,
		identitySource:       runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_NPC_WORLD_ACTOR,
		executionOwner:       runtimev1.ParticipationExecutionOwner_PARTICIPATION_EXECUTION_OWNER_RUNTIME,
		memoryReadScope:      runtimev1.ParticipationMemoryReadScope_PARTICIPATION_MEMORY_READ_SCOPE_DOMAIN_SHARED_ONLY,
		memoryWriteDefault:   runtimev1.ParticipationMemoryWriteDefault_PARTICIPATION_MEMORY_WRITE_DEFAULT_WRITE_NONE,
		capabilityScope:      runtimev1.ParticipationCapabilityScope_PARTICIPATION_CAPABILITY_SCOPE_DOMAIN_LIMITED,
		inputTrust:           runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_WORLD_CONTEXT,
		outputDestination:    runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_WORLD_EVENT_CANDIDATE,
		promotionPosture:     runtimev1.ParticipationPromotionPosture_PARTICIPATION_PROMOTION_POSTURE_EXPLICIT_CANDIDATE,
		executionConcurrency: runtimev1.ParticipationExecutionConcurrency_PARTICIPATION_EXECUTION_CONCURRENCY_DOMAIN_TRIGGER_QUEUE,
		posture:              participationPostureFutureConsumerOnly,
	},
	{
		// K-AGCORE-079 external_agent_entry: gateway verdict required; the
		// per-identity-source boundary is the K-AGCORE-089 matrix below.
		kind:            runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY,
		sourceRule:      "K-AGCORE-079",
		transcriptOwner: runtimev1.ParticipationTranscriptOwner_PARTICIPATION_TRANSCRIPT_OWNER_EXTERNAL_DOMAIN,
		identitySource:  runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_EXTERNAL_A2A_AGENT,
		additionalIdentitySources: []runtimev1.ParticipationIdentitySource{
			runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_MCP_BACKED_AI_CAPABILITY,
		},
		executionOwner:     runtimev1.ParticipationExecutionOwner_PARTICIPATION_EXECUTION_OWNER_EXTERNAL_RUNTIME_VIA_ADMITTED_GATEWAY,
		memoryReadScope:    runtimev1.ParticipationMemoryReadScope_PARTICIPATION_MEMORY_READ_SCOPE_NO_MEMORY_READ,
		memoryWriteDefault: runtimev1.ParticipationMemoryWriteDefault_PARTICIPATION_MEMORY_WRITE_DEFAULT_WRITE_NONE,
		capabilityScope:    runtimev1.ParticipationCapabilityScope_PARTICIPATION_CAPABILITY_SCOPE_EXTERNAL_GATEWAY_LIMITED,
		inputTrust:         runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_EXTERNAL_A2A_PAYLOAD,
		additionalInputTrust: []runtimev1.ParticipationInputTrust{
			runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_TOOL_PROVIDER_PAYLOAD,
		},
		outputDestination:    runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_EXTERNAL_REPLY_CANDIDATE,
		promotionPosture:     runtimev1.ParticipationPromotionPosture_PARTICIPATION_PROMOTION_POSTURE_NOT_ALLOWED,
		executionConcurrency: runtimev1.ParticipationExecutionConcurrency_PARTICIPATION_EXECUTION_CONCURRENCY_GATEWAY_BUDGET_QUEUE,
		posture:              participationPostureGatewayVerdictRequired,
	},
	{
		// K-AGCORE-080 debug_or_probe: diagnostic-only, NOT_ALLOWED promotion.
		kind:                 runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_DEBUG_OR_PROBE,
		sourceRule:           "K-AGCORE-080",
		transcriptOwner:      runtimev1.ParticipationTranscriptOwner_PARTICIPATION_TRANSCRIPT_OWNER_EPHEMERAL,
		identitySource:       runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_USER_OWNED_NIMI_AGENT,
		executionOwner:       runtimev1.ParticipationExecutionOwner_PARTICIPATION_EXECUTION_OWNER_RUNTIME,
		memoryReadScope:      runtimev1.ParticipationMemoryReadScope_PARTICIPATION_MEMORY_READ_SCOPE_NO_MEMORY_READ,
		memoryWriteDefault:   runtimev1.ParticipationMemoryWriteDefault_PARTICIPATION_MEMORY_WRITE_DEFAULT_WRITE_NONE,
		capabilityScope:      runtimev1.ParticipationCapabilityScope_PARTICIPATION_CAPABILITY_SCOPE_DIAGNOSTIC_READ_ONLY,
		inputTrust:           runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_DIAGNOSTIC_INPUT,
		outputDestination:    runtimev1.ParticipationOutputDestination_PARTICIPATION_OUTPUT_DESTINATION_DIAGNOSTIC_CANDIDATE,
		promotionPosture:     runtimev1.ParticipationPromotionPosture_PARTICIPATION_PROMOTION_POSTURE_NOT_ALLOWED,
		executionConcurrency: runtimev1.ParticipationExecutionConcurrency_PARTICIPATION_EXECUTION_CONCURRENCY_LOW_PRIORITY_CANCELABLE,
		posture:              participationPostureDiagnosticOnly,
	},
}

// participationContextBlockRow mirrors one context_blocks: row of
// agent-participation-context-blocks.yaml (K-AGCORE-081). requiredFields are
// verbatim required_fields entries; profiles are verbatim profiles entries.
type participationContextBlockRow struct {
	kind           string
	sourceRule     string
	profiles       []runtimev1.ParticipationProfileKind
	requiredFields []string
}

// participationContextBlockRegistry mirrors
// agent-participation-context-blocks.yaml context_blocks: in table order.
var participationContextBlockRegistry = []participationContextBlockRow{
	{
		kind:           participationBlockRuntimeConversationAnchorRef,
		sourceRule:     "K-AGCORE-075",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_CANONICAL_AGENT_CHAT},
		requiredFields: []string{"conversation_anchor_id"},
	},
	{
		kind:           participationBlockRealmGroupThreadRef,
		sourceRule:     "K-AGCORE-076",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT},
		requiredFields: []string{"thread_id"},
	},
	{
		kind:           participationBlockTriggerMessageRef,
		sourceRule:     "K-AGCORE-076",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT},
		requiredFields: []string{"message_id"},
	},
	{
		kind:       participationBlockParticipantProjection,
		sourceRule: "K-AGCORE-076",
		profiles: []runtimev1.ParticipationProfileKind{
			runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT,
			runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_OASIS_WORLD_PARTICIPATION,
			runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY,
		},
		requiredFields: []string{"participant_ref", "identity_source"},
	},
	{
		kind:           participationBlockRecentGroupTranscriptProjection,
		sourceRule:     "K-AGCORE-076",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT},
		requiredFields: []string{"transcript_ref", "trust_posture"},
	},
	{
		kind:           participationBlockAgentSlotProjection,
		sourceRule:     "K-AGCORE-076",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_REALM_GROUP_AGENT},
		requiredFields: []string{"agent_id", "slot_ref"},
	},
	{
		kind:           participationBlockScenarioPackageRef,
		sourceRule:     "K-AGCORE-077",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_SCENARIO_SANDBOX},
		requiredFields: []string{"scenario_package_id"},
	},
	{
		kind:           participationBlockScenarioRunRef,
		sourceRule:     "K-AGCORE-077",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_SCENARIO_SANDBOX},
		requiredFields: []string{"scenario_run_id"},
	},
	{
		kind:           participationBlockScenarioBranchRef,
		sourceRule:     "K-AGCORE-077",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_SCENARIO_SANDBOX},
		requiredFields: []string{"scenario_branch_id"},
	},
	{
		kind:           participationBlockVisibleSceneState,
		sourceRule:     "K-AGCORE-077",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_SCENARIO_SANDBOX},
		requiredFields: []string{"scene_state_ref"},
	},
	{
		kind:           participationBlockRecentSandboxTranscriptProjection,
		sourceRule:     "K-AGCORE-077",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_SCENARIO_SANDBOX},
		requiredFields: []string{"transcript_ref", "branch_ref", "trust_posture"},
	},
	{
		kind:           participationBlockWorldContextRef,
		sourceRule:     "K-AGCORE-078",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_OASIS_WORLD_PARTICIPATION},
		requiredFields: []string{"world_context_id"},
	},
	{
		kind:           participationBlockWorldEventRef,
		sourceRule:     "K-AGCORE-078",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_OASIS_WORLD_PARTICIPATION},
		requiredFields: []string{"world_event_id"},
	},
	{
		kind:           participationBlockVisibleWorldStateProjection,
		sourceRule:     "K-AGCORE-078",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_OASIS_WORLD_PARTICIPATION},
		requiredFields: []string{"world_state_ref"},
	},
	{
		kind:           participationBlockRecentWorldTranscriptOrEventProjection,
		sourceRule:     "K-AGCORE-078",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_OASIS_WORLD_PARTICIPATION},
		requiredFields: []string{"event_or_transcript_ref", "trust_posture"},
	},
	{
		kind:           participationBlockExternalParticipantIdentityRef,
		sourceRule:     "K-AGCORE-079",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY},
		requiredFields: []string{"external_participant_id", "identity_source"},
	},
	{
		kind:           participationBlockExternalPayloadRef,
		sourceRule:     "K-AGCORE-079",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY},
		requiredFields: []string{"payload_ref", "protocol_kind"},
	},
	{
		kind:           participationBlockGatewayVerdictRef,
		sourceRule:     "K-AGCORE-079",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY},
		requiredFields: []string{"gateway_verdict_id"},
	},
	{
		kind:           participationBlockDomainContextRef,
		sourceRule:     "K-AGCORE-079",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY},
		requiredFields: []string{"domain_ref", "transcript_owner"},
	},
	{
		kind:           participationBlockToolOrCapabilityProjection,
		sourceRule:     "K-AGCORE-079",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_EXTERNAL_AGENT_ENTRY},
		requiredFields: []string{"capability_ref", "effect_class"},
	},
	{
		kind:           participationBlockDiagnosticProbeRef,
		sourceRule:     "K-AGCORE-080",
		profiles:       []runtimev1.ParticipationProfileKind{runtimev1.ParticipationProfileKind_PARTICIPATION_PROFILE_KIND_DEBUG_OR_PROBE},
		requiredFields: []string{"probe_id", "probe_kind"},
	},
}

// participationExternalBoundaryRow mirrors one boundary_entries: row of
// agent-participation-external-entry-boundaries.yaml (K-AGCORE-089). The
// matrix is the Runtime participation view over external protocol pressure;
// K-DELEG-* protocol ownership is referenced, never rewritten.
type participationExternalBoundaryRow struct {
	identitySource         runtimev1.ParticipationIdentitySource
	sourceRule             string
	inputTrust             runtimev1.ParticipationInputTrust
	protocolKind           runtimev1.ParticipationExternalProtocolKind
	requiredContextBlocks  []string
	productionClaimAllowed bool
	productionClaimScope   string
}

// participationExternalBoundaryRegistry mirrors
// agent-participation-external-entry-boundaries.yaml boundary_entries:.
var participationExternalBoundaryRegistry = []participationExternalBoundaryRow{
	{
		// K-AGCORE-090 MCP_BACKED_AI_CAPABILITY: admitted only as delegated
		// gateway evidence (K-DELEG-100..119 owns adapter/protocol authority).
		identitySource: runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_MCP_BACKED_AI_CAPABILITY,
		sourceRule:     "K-AGCORE-090",
		inputTrust:     runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_TOOL_PROVIDER_PAYLOAD,
		protocolKind:   runtimev1.ParticipationExternalProtocolKind_PARTICIPATION_EXTERNAL_PROTOCOL_KIND_MCP,
		requiredContextBlocks: []string{
			participationBlockExternalParticipantIdentityRef,
			participationBlockExternalPayloadRef,
			participationBlockGatewayVerdictRef,
			participationBlockDomainContextRef,
			participationBlockToolOrCapabilityProjection,
		},
		productionClaimAllowed: true,
		productionClaimScope:   "mcp_delegated_adapter_only",
	},
	{
		// K-AGCORE-091 EXTERNAL_A2A_AGENT: future-seam only
		// (K-DELEG-120..129); production claim forbidden.
		identitySource: runtimev1.ParticipationIdentitySource_PARTICIPATION_IDENTITY_SOURCE_EXTERNAL_A2A_AGENT,
		sourceRule:     "K-AGCORE-091",
		inputTrust:     runtimev1.ParticipationInputTrust_PARTICIPATION_INPUT_TRUST_EXTERNAL_A2A_PAYLOAD,
		protocolKind:   runtimev1.ParticipationExternalProtocolKind_PARTICIPATION_EXTERNAL_PROTOCOL_KIND_A2A,
		requiredContextBlocks: []string{
			participationBlockExternalParticipantIdentityRef,
			participationBlockExternalPayloadRef,
			participationBlockGatewayVerdictRef,
			participationBlockDomainContextRef,
		},
		productionClaimAllowed: false,
		productionClaimScope:   "none_until_separate_high_risk_admission",
	},
}

func participationProfileRowByKind(kind runtimev1.ParticipationProfileKind) (participationProfileRow, bool) {
	for _, row := range participationProfileRegistry {
		if row.kind == kind {
			return row, true
		}
	}
	return participationProfileRow{}, false
}

func participationContextBlockRowByKind(kind string) (participationContextBlockRow, bool) {
	for _, row := range participationContextBlockRegistry {
		if row.kind == kind {
			return row, true
		}
	}
	return participationContextBlockRow{}, false
}

func participationExternalBoundaryRowByIdentity(identity runtimev1.ParticipationIdentitySource) (participationExternalBoundaryRow, bool) {
	for _, row := range participationExternalBoundaryRegistry {
		if row.identitySource == identity {
			return row, true
		}
	}
	return participationExternalBoundaryRow{}, false
}

func (r participationProfileRow) admitsIdentitySource(identity runtimev1.ParticipationIdentitySource) bool {
	if r.identitySource == identity {
		return true
	}
	for _, additional := range r.additionalIdentitySources {
		if additional == identity {
			return true
		}
	}
	return false
}

func (r participationContextBlockRow) admitsProfile(kind runtimev1.ParticipationProfileKind) bool {
	for _, profile := range r.profiles {
		if profile == kind {
			return true
		}
	}
	return false
}

// participationRequiredBlockKinds returns the profile-required context block
// set. For external_agent_entry the K-AGCORE-089 boundary matrix declares the
// required set per identity source, so the caller resolves it through
// participationExternalBoundaryRowByIdentity instead. For every other profile
// the closed K-AGCORE-081 registry assignment is the required set: a
// participation request that omits an assigned typed block is executing with
// less context than the profile admits, which fails closed (K-AGCORE-062).
func participationRequiredBlockKinds(kind runtimev1.ParticipationProfileKind) []string {
	required := make([]string, 0, len(participationContextBlockRegistry))
	for _, row := range participationContextBlockRegistry {
		if row.admitsProfile(kind) {
			required = append(required, row.kind)
		}
	}
	return required
}

func (r participationProfileRow) descriptor() *runtimev1.ParticipationProfileDescriptor {
	return &runtimev1.ParticipationProfileDescriptor{
		ProfileKind:               r.kind,
		TranscriptOwner:           r.transcriptOwner,
		IdentitySource:            r.identitySource,
		AdditionalIdentitySources: append([]runtimev1.ParticipationIdentitySource(nil), r.additionalIdentitySources...),
		ExecutionOwner:            r.executionOwner,
		MemoryReadScope:           r.memoryReadScope,
		MemoryWriteDefault:        r.memoryWriteDefault,
		CapabilityScope:           r.capabilityScope,
		InputTrust:                r.inputTrust,
		AdditionalInputTrust:      append([]runtimev1.ParticipationInputTrust(nil), r.additionalInputTrust...),
		OutputDestination:         r.outputDestination,
		PromotionPosture:          r.promotionPosture,
		ExecutionConcurrency:      r.executionConcurrency,
		Posture:                   r.posture,
	}
}

func (r participationContextBlockRow) descriptor() *runtimev1.ParticipationContextBlockDescriptor {
	return &runtimev1.ParticipationContextBlockDescriptor{
		BlockKind:           r.kind,
		AllowedProfileKinds: append([]runtimev1.ParticipationProfileKind(nil), r.profiles...),
		RequiredFields:      append([]string(nil), r.requiredFields...),
	}
}
