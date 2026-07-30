package localappop

import "strings"

type selectorShape uint8

const (
	selectorArtifact selectorShape = iota + 1
	selectorAgent
	selectorAgentAnchor
	selectorAgentAnchorTurn
	selectorStorage
)

type operationSpec struct {
	selector       selectorShape
	authorityClass AuthorityClass
}

var operationSpecs = map[Operation]operationSpec{
	OperationArtifactRead:          {selector: selectorArtifact, authorityClass: AuthorityClassUserPermission},
	OperationConversationOpen:      {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationConversationTurnSend:  {selector: selectorAgentAnchorTurn, authorityClass: AuthorityClassUserPermission},
	OperationConversationSubscribe: {selector: selectorAgentAnchor, authorityClass: AuthorityClassUserPermission},
	OperationConversationSnapshot:  {selector: selectorAgentAnchor, authorityClass: AuthorityClassUserPermission},
	OperationConfigurationSnapshot: {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationUpdateConfiguration:   {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationReadinessSnapshot:     {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationAutonomySnapshot:      {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationUpdateAutonomy:        {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationPresentationSnapshot:  {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationCommitPresentation:    {selector: selectorAgent, authorityClass: AuthorityClassUserPermission},
	OperationStorageJSONRead:       {selector: selectorStorage, authorityClass: AuthorityClassBaseEntitlement},
	OperationStorageJSONWrite:      {selector: selectorStorage, authorityClass: AuthorityClassBaseEntitlement},
	OperationStorageJSONRemove:     {selector: selectorStorage, authorityClass: AuthorityClassBaseEntitlement},
}

// AuthorityClassForOperation returns the Runtime-owned authority path for an
// exact closed operation. Callers cannot select or override this value.
func AuthorityClassForOperation(operation Operation) (AuthorityClass, bool) {
	spec, ok := operationSpecs[operation]
	if !ok {
		return "", false
	}
	return spec.authorityClass, true
}

func validateRequest(req Request) Reason {
	if !validOpaque(req.NativeConnectionRef) {
		return ReasonProtocolEnvelopeInvalid
	}
	spec, ok := operationSpecs[req.Operation]
	if !ok {
		return ReasonLocalAppOperationUnavailable
	}
	if !selectorMatches(spec.selector, req.Selector) {
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
