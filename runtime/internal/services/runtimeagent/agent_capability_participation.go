package runtimeagent

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// @nimi-authority: definition.nimi.runtime.agent-participation.capability-participation
// @nimi-authority: rule.nimi.runtime.agent-participation.r181
func projectLocalAgentCapabilityParticipation() []*runtimev1.LocalAgentCapabilityParticipation {
	return []*runtimev1.LocalAgentCapabilityParticipation{
		{Role: runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_PRIMARY, CapabilityContract: "text.generate"},
		{Role: runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_MEMORY_EMBEDDING, CapabilityContract: "text.embed"},
		{Role: runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_INPUT_VOICE, CapabilityContract: "audio.transcribe"},
		{Role: runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_OUTPUT_VOICE, CapabilityContract: "audio.synthesize"},
		{Role: runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_REALTIME, CapabilityContract: "realtime.interact"},
		{Role: runtimev1.LocalAgentCapabilityParticipationRole_LOCAL_AGENT_CAPABILITY_PARTICIPATION_ROLE_CONVERSATION_ACTION_IMAGE, CapabilityContract: "image.generate"},
	}
}
