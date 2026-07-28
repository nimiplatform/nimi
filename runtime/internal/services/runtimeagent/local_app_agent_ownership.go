package runtimeagent

import (
	"context"
	"fmt"
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

// ProjectOwnedLocalAgent exposes one already-selected Agent to the protected
// owner plane without providing an account-wide inventory surface.
func (s *Service) ProjectOwnedLocalAgent(_ context.Context, accountID string, localAgentID string) (accountservice.LocalAgentOwnerProjection, error) {
	if s == nil || accountID == "" || accountID != strings.TrimSpace(accountID) || localAgentID == "" || localAgentID != strings.TrimSpace(localAgentID) {
		return accountservice.LocalAgentOwnerProjection{}, fmt.Errorf("invalid selected Agent projection binding")
	}
	entry, err := s.agentByID(localAgentID)
	if err != nil || entry.Agent == nil || strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID ||
		strings.TrimSpace(entry.Agent.GetDisplayName()) == "" {
		return accountservice.LocalAgentOwnerProjection{}, fmt.Errorf("selected Agent projection unavailable")
	}
	return accountservice.LocalAgentOwnerProjection{LocalAgentID: entry.Agent.GetLocalAgentRef(), DisplayName: entry.Agent.GetDisplayName()}, nil
}
