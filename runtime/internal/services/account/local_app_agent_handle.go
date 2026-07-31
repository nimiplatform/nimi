package account

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

var (
	ErrLocalAppSelectorUnavailable = errors.New("local-app owner selector unavailable")
	ErrLocalAppSelectorMismatch    = errors.New("local-app owner selector binding mismatch")
	ErrLocalAppAgentScopeRequired  = errors.New("local-app effective Agent scope required")
	ErrLocalAppAgentScopeRevoked   = errors.New("local-app effective Agent scope revoked")
)

const localAppAgentPermissionID = "agents.interact"

type materializedLocalAppAgent struct {
	Handle      string
	DisplayName string
	AvatarURL   *string
}

func (s *Service) materializeAccountAgentHandles(ctx context.Context, caller LocalAppCallerDecision, permissionID, ownerSelectorDigest string) ([]materializedLocalAppAgent, error) {
	handlePermissionID, supported := localAppAgentHandlePermissionID(permissionID)
	if s == nil || s.localAppKernel == nil || s.localAgentOwnership == nil || !supported ||
		ownerSelectorDigest != localappkernel.AgentAccountScopeDigest(caller.AccountID) {
		return nil, ErrLocalAppSelectorUnavailable
	}
	if permissionID == "agents.configure" && !s.usableLocalAppAgentGrant(ctx, caller, localAppAgentPermissionID, ownerSelectorDigest) {
		return nil, ErrLocalAppSelectorUnavailable
	}
	agents, err := s.localAgentOwnership.ListOwnedActiveLocalAgents(ctx, caller.AccountID)
	if err != nil {
		return nil, ErrLocalAppSelectorUnavailable
	}
	sort.Slice(agents, func(i, j int) bool {
		if agents[i].DisplayName == agents[j].DisplayName {
			return agents[i].LocalAgentID < agents[j].LocalAgentID
		}
		return agents[i].DisplayName < agents[j].DisplayName
	})
	materialized := make([]materializedLocalAppAgent, 0, len(agents))
	seenAgentIDs := make(map[string]struct{}, len(agents))
	for _, agent := range agents {
		if !exactSelectorText(agent.LocalAgentID) ||
			!canonicalLocalAppAgentDisplayName(agent.DisplayName) ||
			!canonicalLocalAppAgentAvatarURL(agent.AvatarURL) {
			return nil, ErrLocalAppSelectorMismatch
		}
		if _, duplicate := seenAgentIDs[agent.LocalAgentID]; duplicate {
			return nil, ErrLocalAppSelectorMismatch
		}
		seenAgentIDs[agent.LocalAgentID] = struct{}{}
		issued, issueErr := s.localAppKernel.AgentHandles().EnsureAccountScope(ctx, localappkernel.EnsureAccountScopeAgentHandleInput{
			AccountID:           caller.AccountID,
			LocalAppPrincipalID: caller.LocalAppPrincipalID,
			PermissionID:        handlePermissionID,
			OwnerSelectorDigest: ownerSelectorDigest,
			LocalAgentID:        agent.LocalAgentID,
		})
		if issueErr != nil {
			return nil, ErrLocalAppSelectorUnavailable
		}
		materialized = append(materialized, materializedLocalAppAgent{
			Handle:      issued.Handle,
			DisplayName: agent.DisplayName,
			AvatarURL:   agent.AvatarURL,
		})
	}
	return materialized, nil
}

// ResolveLocalAppAgentHandle accepts only a Runtime-materialized opaque handle
// from the app path. A raw localAgentId is therefore never authority.
func (s *Service) ResolveLocalAppAgentHandle(ctx context.Context, handle string, permissionID string) (localappkernel.AgentHandle, error) {
	handlePermissionID, supported := localAppAgentHandlePermissionID(permissionID)
	if s == nil || s.localAppKernel == nil || s.localAgentOwnership == nil || !exactSelectorText(handle) || !supported {
		return localappkernel.AgentHandle{}, ErrLocalAppSelectorUnavailable
	}
	caller, err := s.AuthorizeLocalAppCaller(ctx)
	if err != nil || caller.LocalOSUserAnchor != s.localAppKernel.LocalOSUserAnchor() {
		return localappkernel.AgentHandle{}, ErrLocalAppSelectorMismatch
	}
	ownerSelectorDigest := localappkernel.AgentAccountScopeDigest(caller.AccountID)
	if permissionID == "agents.configure" {
		interactPosture, postureErr := s.localAppAgentGrantPosture(ctx, caller, localAppAgentPermissionID, ownerSelectorDigest)
		if postureErr != nil {
			return localappkernel.AgentHandle{}, ErrLocalAppAgentScopeRequired
		}
		if !interactPosture.Usable {
			if interactPosture.Reason == apppermission.PostureReasonGrantRevoked {
				return localappkernel.AgentHandle{}, ErrLocalAppAgentScopeRevoked
			}
			return localappkernel.AgentHandle{}, ErrLocalAppSelectorMismatch
		}
	}
	resolved, err := s.localAppKernel.AgentHandles().Resolve(ctx, localappkernel.ResolveAgentHandleInput{
		Handle: handle, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID, PermissionID: handlePermissionID,
	})
	if err != nil {
		return localappkernel.AgentHandle{}, ErrLocalAppSelectorMismatch
	}
	if resolved.OwnerSelectorDigest != ownerSelectorDigest {
		return localappkernel.AgentHandle{}, ErrLocalAppSelectorMismatch
	}
	owned, err := s.localAgentOwnership.OwnsActiveLocalAgent(ctx, caller.AccountID, resolved.LocalAgentID)
	if err != nil || !owned {
		return localappkernel.AgentHandle{}, ErrLocalAppSelectorMismatch
	}
	return resolved, nil
}

func localAppAgentHandlePermissionID(permissionID string) (string, bool) {
	switch permissionID {
	case localAppAgentPermissionID, "agents.configure":
		return localAppAgentPermissionID, true
	default:
		return "", false
	}
}

func (s *Service) usableLocalAppAgentGrant(ctx context.Context, caller LocalAppCallerDecision, permissionID, ownerSelectorDigest string) bool {
	posture, err := s.localAppAgentGrantPosture(ctx, caller, permissionID, ownerSelectorDigest)
	return err == nil && posture.Usable
}

func (s *Service) localAppAgentGrantPosture(ctx context.Context, caller LocalAppCallerDecision, permissionID, ownerSelectorDigest string) (apppermission.PostureEvaluation, error) {
	key := localappkernel.PermissionGrantKey{
		LocalOSUserAnchor:   caller.LocalOSUserAnchor,
		AccountID:           caller.AccountID,
		LocalAppPrincipalID: caller.LocalAppPrincipalID,
		PermissionID:        permissionID,
		OwnerSelectorDigest: ownerSelectorDigest,
	}
	grant, err := s.localAppKernel.PermissionGrants().Get(ctx, key)
	if err != nil {
		return apppermission.PostureEvaluation{}, err
	}
	return apppermission.EvaluatePosture(s.now().UTC(), true, true, key, &grant), nil
}

func exactSelectorText(value string) bool {
	return value != "" && value == strings.TrimSpace(value)
}
