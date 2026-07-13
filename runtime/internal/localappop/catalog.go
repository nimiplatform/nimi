package localappop

import "strings"

type selectorShape uint8

const (
	selectorArtifact selectorShape = iota + 1
	selectorAgent
	selectorAgentAnchor
	selectorAgentAnchorTurn
)

var operationSpecs = map[Operation]selectorShape{
	OperationArtifactRead:          selectorArtifact,
	OperationConversationOpen:      selectorAgent,
	OperationConversationTurnSend:  selectorAgentAnchor,
	OperationConversationSubscribe: selectorAgentAnchorTurn,
	OperationConversationSnapshot:  selectorAgentAnchor,
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
		!validOptionalOpaque(selector.ConversationAnchorID) || !validOptionalOpaque(selector.TurnID) {
		return false
	}
	artifact := selector.ArtifactID != ""
	agent := selector.AgentID != ""
	anchor := selector.ConversationAnchorID != ""
	turn := selector.TurnID != ""

	switch shape {
	case selectorArtifact:
		return artifact && !agent && !anchor && !turn
	case selectorAgent:
		return !artifact && agent && !anchor && !turn
	case selectorAgentAnchor:
		return !artifact && agent && anchor && !turn
	case selectorAgentAnchorTurn:
		return !artifact && agent && anchor && turn
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
