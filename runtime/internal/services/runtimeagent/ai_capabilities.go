package runtimeagent

import "github.com/nimiplatform/nimi/runtime/internal/aicapabilities"

// These aliases keep Runtime Agent execution consumers on the canonical
// capability vocabulary without recreating the retired per-Agent AIConfig
// domain.
const (
	runtimeAgentAIConfigCapabilityTextGenerate        = aicapabilities.TextGenerate
	runtimeAgentAIConfigCapabilityTextEmbed           = aicapabilities.TextEmbed
	runtimeAgentAIConfigCapabilityImageGenerate       = aicapabilities.ImageGenerate
	runtimeAgentAIConfigCapabilityAudioSynthesize     = aicapabilities.AudioSynthesize
	runtimeAgentAIConfigCapabilityAudioTranscribe     = aicapabilities.AudioTranscribe
	runtimeAgentAIConfigCapabilityVoiceWorkflowClone  = aicapabilities.VoiceWorkflowVoiceClone
	runtimeAgentAIConfigCapabilityVoiceWorkflowDesign = aicapabilities.VoiceWorkflowVoiceDesign
)
