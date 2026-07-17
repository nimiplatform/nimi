package localappop

import "strings"

type selectorShape uint8

const (
	selectorArtifact selectorShape = iota + 1
	selectorAgent
	selectorAgentAnchor
	selectorAgentAnchorTurn
	selectorAgentAnchorTurnVoice
	selectorStorage
)

var operationSpecs = map[Operation]selectorShape{
	OperationArtifactRead:          selectorArtifact,
	OperationConversationOpen:      selectorAgent,
	OperationConversationTurnSend:  selectorAgentAnchorTurn,
	OperationConversationSubscribe: selectorAgentAnchor,
	OperationConversationSnapshot:  selectorAgentAnchor,
	OperationStorageJSONRead:       selectorStorage,
	OperationStorageJSONWrite:      selectorStorage,
	OperationStorageJSONRemove:     selectorStorage,
	OperationVoiceTranscribe:       selectorAgent,
	OperationVoiceStreamSubscribe:  selectorAgentAnchorTurnVoice,
}

func validateRequest(req Request) Reason {
	if !validOpaque(req.NativeConnectionRef) {
		return ReasonProtocolEnvelopeInvalid
	}
	shape, ok := operationSpecs[req.Operation]
	if !ok {
		return ReasonLocalAppOperationUnavailable
	}
	if !selectorMatches(shape, req.Selector) {
		return ReasonProtocolEnvelopeInvalid
	}
	return ""
}

func selectorMatches(shape selectorShape, selector Selector) bool {
	if !validOptionalOpaque(selector.ArtifactID) || !validOptionalOpaque(selector.AgentID) ||
		!validOptionalOpaque(selector.ConversationAnchorID) || !validOptionalOpaque(selector.TurnID) ||
		!validOptionalOpaque(selector.VoiceStreamID) ||
		!validOptionalOpaque(selector.StorageRelativePath) {
		return false
	}
	artifact := selector.ArtifactID != ""
	agent := selector.AgentID != ""
	anchor := selector.ConversationAnchorID != ""
	turn := selector.TurnID != ""
	voiceStream := selector.VoiceStreamID != ""
	storage := selector.StorageRelativePath != ""

	switch shape {
	case selectorArtifact:
		return artifact && !agent && !anchor && !turn && !voiceStream && !storage
	case selectorAgent:
		return !artifact && agent && !anchor && !turn && !voiceStream && !storage
	case selectorAgentAnchor:
		return !artifact && agent && anchor && !turn && !voiceStream && !storage
	case selectorAgentAnchorTurn:
		return !artifact && agent && anchor && turn && !voiceStream && !storage
	case selectorAgentAnchorTurnVoice:
		return !artifact && agent && anchor && turn && voiceStream && !storage
	case selectorStorage:
		return !artifact && !agent && !anchor && !turn && !voiceStream && storage
	default:
		return false
	}
}

func validOpaque(value string) bool {
	return value != "" && strings.TrimSpace(value) == value
}

func validOptionalOpaque(value string) bool {
	return value == "" || validOpaque(value)
}

func equalSelector(left, right Selector) bool {
	return left == right
}
