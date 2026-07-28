package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type localAppOperationAuthorizer interface {
	AuthorizeLocalAppProtectedOperation(context.Context, accountservice.LocalAppOperation, localappop.Selector) (accountservice.LocalAppCallerDecision, error)
}

func (s *Service) SetLocalAppOperationAuthorizer(authorizer localAppOperationAuthorizer) {
	if s != nil {
		s.localAppOperationAuth = authorizer
	}
}

// OwnsActiveLocalAgent supplies the canonical Agent-owner check used before an
// owner selector handle is issued or resolved. It exposes no inventory.
func (s *Service) OwnsActiveLocalAgent(_ context.Context, accountID string, localAgentID string) (bool, error) {
	if s == nil || accountID == "" || accountID != strings.TrimSpace(accountID) || localAgentID == "" || localAgentID != strings.TrimSpace(localAgentID) {
		return false, nil
	}
	entry, err := s.agentByID(localAgentID)
	if err != nil {
		return false, nil
	}
	return entry.Agent != nil && strings.TrimSpace(entry.Agent.GetOwnerUserId()) == accountID &&
		entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, nil
}
