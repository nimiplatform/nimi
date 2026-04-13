package memoryengine

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func LocatorKeyFromMemoryBankLocator(locator *runtimev1.MemoryBankLocator) (string, error) {
	scope, err := ScopeFromMemoryBankLocator(locator)
	if err != nil {
		return "", err
	}
	return LocatorKey(scope)
}

func ScopeFromLocatorKey(raw string) (ScopeDescriptor, error) {
	parts := strings.Split(strings.TrimSpace(raw), "::")
	if len(parts) < 2 {
		return ScopeDescriptor{}, fmt.Errorf("invalid locator key %q", raw)
	}
	switch parts[0] {
	case "agent-core":
		if len(parts) != 2 {
			return ScopeDescriptor{}, fmt.Errorf("agent-core locator key requires exactly 2 parts")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeSingleton,
			Principals: []ScopePrincipal{
				{Role: RoleAgent, ID: parts[1]},
			},
		})
	case "agent-dyadic":
		if len(parts) != 3 {
			return ScopeDescriptor{}, fmt.Errorf("agent-dyadic locator key requires exactly 3 parts")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopePair,
			Principals: []ScopePrincipal{
				{Role: RoleAgent, ID: parts[1]},
				{Role: RoleUser, ID: parts[2]},
			},
		})
	case "world-shared":
		if len(parts) != 2 {
			return ScopeDescriptor{}, fmt.Errorf("world-shared locator key requires exactly 2 parts")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeGroup,
			Principals: []ScopePrincipal{
				{Role: RoleWorld, ID: parts[1]},
			},
		})
	case "app-private":
		if len(parts) != 3 {
			return ScopeDescriptor{}, fmt.Errorf("app-private locator key requires exactly 3 parts")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeAppPrivate,
			Principals: []ScopePrincipal{
				{Role: RoleAccount, ID: parts[1]},
				{Role: RoleApp, ID: parts[2]},
			},
		})
	case "workspace-private":
		if len(parts) != 3 {
			return ScopeDescriptor{}, fmt.Errorf("workspace-private locator key requires exactly 3 parts")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeWorkspacePrivate,
			Principals: []ScopePrincipal{
				{Role: RoleAccount, ID: parts[1]},
				{Role: RoleWorkspace, ID: parts[2]},
			},
		})
	default:
		return ScopeDescriptor{}, fmt.Errorf("unsupported locator key prefix %q", parts[0])
	}
}

func LocatorKeyToMemoryBankLocator(raw string) (*runtimev1.MemoryBankLocator, error) {
	scope, err := ScopeFromLocatorKey(raw)
	if err != nil {
		return nil, err
	}
	return ScopeToMemoryBankLocator(scope)
}

func OwnerFilterKey(filter *runtimev1.MemoryBankOwnerFilter) (string, error) {
	if filter == nil {
		return "", fmt.Errorf("memory bank owner filter is required")
	}
	switch {
	case filter.GetAgentCore() != nil:
		return LocatorKey(ScopeDescriptor{
			Kind: ScopeSingleton,
			Principals: []ScopePrincipal{
				{Role: RoleAgent, ID: filter.GetAgentCore().GetAgentId()},
			},
		})
	case filter.GetAgentDyadic() != nil:
		return LocatorKey(ScopeDescriptor{
			Kind: ScopePair,
			Principals: []ScopePrincipal{
				{Role: RoleAgent, ID: filter.GetAgentDyadic().GetAgentId()},
				{Role: RoleUser, ID: filter.GetAgentDyadic().GetUserId()},
			},
		})
	case filter.GetWorldShared() != nil:
		return LocatorKey(ScopeDescriptor{
			Kind: ScopeGroup,
			Principals: []ScopePrincipal{
				{Role: RoleWorld, ID: filter.GetWorldShared().GetWorldId()},
			},
		})
	case filter.GetAppPrivate() != nil:
		return LocatorKey(ScopeDescriptor{
			Kind: ScopeAppPrivate,
			Principals: []ScopePrincipal{
				{Role: RoleAccount, ID: filter.GetAppPrivate().GetAccountId()},
				{Role: RoleApp, ID: filter.GetAppPrivate().GetAppId()},
			},
		})
	case filter.GetWorkspacePrivate() != nil:
		return LocatorKey(ScopeDescriptor{
			Kind: ScopeWorkspacePrivate,
			Principals: []ScopePrincipal{
				{Role: RoleAccount, ID: filter.GetWorkspacePrivate().GetAccountId()},
				{Role: RoleWorkspace, ID: filter.GetWorkspacePrivate().GetWorkspaceId()},
			},
		})
	default:
		return "", fmt.Errorf("memory bank owner filter requires one admitted owner branch")
	}
}

func ScopeFromMemoryBankLocator(locator *runtimev1.MemoryBankLocator) (ScopeDescriptor, error) {
	if locator == nil {
		return ScopeDescriptor{}, fmt.Errorf("memory bank locator is required")
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		owner := locator.GetAgentCore()
		if owner == nil || strings.TrimSpace(owner.GetAgentId()) == "" {
			return ScopeDescriptor{}, fmt.Errorf("agent_core locator requires agent_id")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeSingleton,
			Principals: []ScopePrincipal{
				{Role: RoleAgent, ID: owner.GetAgentId()},
			},
		})
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		owner := locator.GetAgentDyadic()
		if owner == nil || strings.TrimSpace(owner.GetAgentId()) == "" || strings.TrimSpace(owner.GetUserId()) == "" {
			return ScopeDescriptor{}, fmt.Errorf("agent_dyadic locator requires agent_id and user_id")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopePair,
			Principals: []ScopePrincipal{
				{Role: RoleAgent, ID: owner.GetAgentId()},
				{Role: RoleUser, ID: owner.GetUserId()},
			},
		})
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		owner := locator.GetWorldShared()
		if owner == nil || strings.TrimSpace(owner.GetWorldId()) == "" {
			return ScopeDescriptor{}, fmt.Errorf("world_shared locator requires world_id")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeGroup,
			Principals: []ScopePrincipal{
				{Role: RoleWorld, ID: owner.GetWorldId()},
			},
		})
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE:
		owner := locator.GetAppPrivate()
		if owner == nil || strings.TrimSpace(owner.GetAccountId()) == "" || strings.TrimSpace(owner.GetAppId()) == "" {
			return ScopeDescriptor{}, fmt.Errorf("app_private locator requires account_id and app_id")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeAppPrivate,
			Principals: []ScopePrincipal{
				{Role: RoleAccount, ID: owner.GetAccountId()},
				{Role: RoleApp, ID: owner.GetAppId()},
			},
		})
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE:
		owner := locator.GetWorkspacePrivate()
		if owner == nil || strings.TrimSpace(owner.GetAccountId()) == "" || strings.TrimSpace(owner.GetWorkspaceId()) == "" {
			return ScopeDescriptor{}, fmt.Errorf("workspace_private locator requires account_id and workspace_id")
		}
		return NormalizeScope(ScopeDescriptor{
			Kind: ScopeWorkspacePrivate,
			Principals: []ScopePrincipal{
				{Role: RoleAccount, ID: owner.GetAccountId()},
				{Role: RoleWorkspace, ID: owner.GetWorkspaceId()},
			},
		})
	default:
		return ScopeDescriptor{}, fmt.Errorf("unsupported memory bank scope %q", locator.GetScope())
	}
}

func ScopeToMemoryBankLocator(input ScopeDescriptor) (*runtimev1.MemoryBankLocator, error) {
	scope, err := NormalizeScope(input)
	if err != nil {
		return nil, err
	}
	switch scope.Kind {
	case ScopeSingleton:
		agentID, err := requirePrincipal(scope, RoleAgent)
		if err != nil {
			return nil, err
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentID},
			},
		}, nil
	case ScopePair:
		agentID, err := requirePrincipal(scope, RoleAgent)
		if err != nil {
			return nil, err
		}
		userID, err := requirePrincipal(scope, RoleUser)
		if err != nil {
			return nil, err
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
			Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
				AgentDyadic: &runtimev1.AgentDyadicBankOwner{
					AgentId: agentID,
					UserId:  userID,
				},
			},
		}, nil
	case ScopeGroup:
		worldID, err := requirePrincipal(scope, RoleWorld)
		if err != nil {
			return nil, err
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
			Owner: &runtimev1.MemoryBankLocator_WorldShared{
				WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: worldID},
			},
		}, nil
	case ScopeAppPrivate:
		accountID, err := requirePrincipal(scope, RoleAccount)
		if err != nil {
			return nil, err
		}
		appID, err := requirePrincipal(scope, RoleApp)
		if err != nil {
			return nil, err
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE,
			Owner: &runtimev1.MemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{
					AccountId: accountID,
					AppId:     appID,
				},
			},
		}, nil
	case ScopeWorkspacePrivate:
		accountID, err := requirePrincipal(scope, RoleAccount)
		if err != nil {
			return nil, err
		}
		workspaceID, err := requirePrincipal(scope, RoleWorkspace)
		if err != nil {
			return nil, err
		}
		return &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE,
			Owner: &runtimev1.MemoryBankLocator_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.WorkspacePrivateBankOwner{
					AccountId:   accountID,
					WorkspaceId: workspaceID,
				},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported scope kind %q", scope.Kind)
	}
}

func LocatorKey(input ScopeDescriptor) (string, error) {
	scope, err := NormalizeScope(input)
	if err != nil {
		return "", err
	}
	switch scope.Kind {
	case ScopeSingleton:
		agentID, err := requirePrincipal(scope, RoleAgent)
		if err != nil {
			return "", err
		}
		return "agent-core::" + agentID, nil
	case ScopePair:
		agentID, err := requirePrincipal(scope, RoleAgent)
		if err != nil {
			return "", err
		}
		userID, err := requirePrincipal(scope, RoleUser)
		if err != nil {
			return "", err
		}
		return "agent-dyadic::" + agentID + "::" + userID, nil
	case ScopeGroup:
		worldID, err := requirePrincipal(scope, RoleWorld)
		if err != nil {
			return "", err
		}
		return "world-shared::" + worldID, nil
	case ScopeAppPrivate:
		accountID, err := requirePrincipal(scope, RoleAccount)
		if err != nil {
			return "", err
		}
		appID, err := requirePrincipal(scope, RoleApp)
		if err != nil {
			return "", err
		}
		return "app-private::" + accountID + "::" + appID, nil
	case ScopeWorkspacePrivate:
		accountID, err := requirePrincipal(scope, RoleAccount)
		if err != nil {
			return "", err
		}
		workspaceID, err := requirePrincipal(scope, RoleWorkspace)
		if err != nil {
			return "", err
		}
		return "workspace-private::" + accountID + "::" + workspaceID, nil
	default:
		return "", fmt.Errorf("unsupported scope kind %q", scope.Kind)
	}
}

func requirePrincipal(input ScopeDescriptor, role PrincipalRole) (string, error) {
	for _, principal := range input.Principals {
		if principal.Role == role {
			return principal.ID, nil
		}
	}
	return "", fmt.Errorf("%s scope cannot map to current Nimi locator without role %q", input.Kind, role)
}
