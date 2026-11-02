package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.agent-service.r051
// References are already validated by the materialization and restore owners.
// Revisions describe captured settings, not a second Character identity.
func sameMaterializedCharacter(left, right *runtimev1.CharacterSourceRefV3) bool {
	if left == nil || right == nil {
		return false
	}
	if a, b := left.GetWorldCharacter(), right.GetWorldCharacter(); a != nil && b != nil {
		return a.GetId() == b.GetId() && a.GetWorldId() == b.GetWorldId() && proto.Equal(a.GetWorldEntityRef(), b.GetWorldEntityRef())
	}
	if a, b := left.GetPersonaCharacter(), right.GetPersonaCharacter(); a != nil && b != nil {
		return a.GetId() == b.GetId() && a.GetWorldId() == b.GetWorldId() && a.GetOwnerAccountId() == b.GetOwnerAccountId()
	}
	return false
}
