package account

import (
	"context"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

var (
	ErrLocalAppSelectorUnavailable = errors.New("local-app owner selector unavailable")
	ErrLocalAppSelectorMismatch    = errors.New("local-app owner selector binding mismatch")
)

const localAppAgentPermissionID = "agents.interact"

// IssueOwnerLocalAppAgentSelectorHandle is the Runtime management-plane entry
// used by the canonical desktop Agent picker. It accepts a raw LocalAgent id
// only from a protected desktop account-control caller and persists only after
// current account ownership is confirmed by the Agent owner.
func (s *Service) IssueOwnerLocalAppAgentSelectorHandle(ctx context.Context, caller *runtimev1.AccountCaller, localAppPrincipalID string, permissionID string, localAgentID string) (localappkernel.AgentSelectorHandle, error) {
	if s == nil || s.localAppKernel == nil || s.localAgentOwnership == nil {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorUnavailable
	}
	if reason, ok := s.validateRuntimeAccountControlCaller(ctx, caller); !ok {
		return localappkernel.AgentSelectorHandle{}, fmt.Errorf("%w: %s", ErrLocalAppSelectorUnavailable, reason.String())
	}
	if !exactSelectorText(localAppPrincipalID) || permissionID != localAppAgentPermissionID || !exactSelectorText(localAgentID) {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorMismatch
	}
	projection, _, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	accountID := strings.TrimSpace(projection.GetAccountId())
	if !authenticated || accountID == "" {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorUnavailable
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, localAppPrincipalID)
	if err != nil || principal.State != localappkernel.PrincipalStateActive || principal.LocalOSUserAnchor != s.localAppKernel.LocalOSUserAnchor() {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorMismatch
	}
	owned, err := s.localAgentOwnership.OwnsActiveLocalAgent(ctx, accountID, localAgentID)
	if err != nil || !owned {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorMismatch
	}
	issued, err := s.localAppKernel.AgentSelectorHandles().Issue(ctx, localappkernel.IssueAgentSelectorHandleInput{
		AccountID: accountID, LocalAppPrincipalID: localAppPrincipalID, PermissionID: permissionID, LocalAgentID: localAgentID,
	})
	if err != nil {
		return localappkernel.AgentSelectorHandle{}, fmt.Errorf("issue owner local-app Agent selector: %w", err)
	}
	return issued, nil
}

// ResolveLocalAppAgentSelectorHandle accepts only an owner-issued opaque
// handle from the app path. A raw localAgentId is therefore never authority.
func (s *Service) ResolveLocalAppAgentSelectorHandle(ctx context.Context, handle string, permissionID string) (localappkernel.AgentSelectorHandle, error) {
	if s == nil || s.localAppKernel == nil || s.localAgentOwnership == nil || !exactSelectorText(handle) || permissionID != localAppAgentPermissionID {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorUnavailable
	}
	caller, err := s.AuthorizeLocalAppCaller(ctx)
	if err != nil || caller.LocalOSUserAnchor != s.localAppKernel.LocalOSUserAnchor() {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorMismatch
	}
	resolved, err := s.localAppKernel.AgentSelectorHandles().Resolve(ctx, localappkernel.ResolveAgentSelectorHandleInput{
		Handle: handle, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID, PermissionID: permissionID,
	})
	if err != nil {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorMismatch
	}
	owned, err := s.localAgentOwnership.OwnsActiveLocalAgent(ctx, caller.AccountID, resolved.LocalAgentID)
	if err != nil || !owned {
		return localappkernel.AgentSelectorHandle{}, ErrLocalAppSelectorMismatch
	}
	return resolved, nil
}

func exactSelectorText(value string) bool {
	return value != "" && value == strings.TrimSpace(value)
}
