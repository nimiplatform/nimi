package memoryengine

import (
	"fmt"
	"sort"
	"strings"
)

type ScopeKind string

const (
	ScopeSingleton        ScopeKind = "singleton"
	ScopePair             ScopeKind = "pair"
	ScopeGroup            ScopeKind = "group"
	ScopeAppPrivate       ScopeKind = "app_private"
	ScopeWorkspacePrivate ScopeKind = "workspace_private"
)

type PrincipalRole string

const (
	RoleAgent     PrincipalRole = "agent"
	RoleUser      PrincipalRole = "user"
	RoleWorld     PrincipalRole = "world"
	RoleAccount   PrincipalRole = "account"
	RoleApp       PrincipalRole = "app"
	RoleWorkspace PrincipalRole = "workspace"
)

type ScopePrincipal struct {
	Role PrincipalRole
	ID   string
}

type ScopeDescriptor struct {
	Kind       ScopeKind
	Principals []ScopePrincipal
}

var roleOrder = map[PrincipalRole]int{
	RoleAgent:     10,
	RoleUser:      20,
	RoleWorld:     30,
	RoleAccount:   40,
	RoleApp:       50,
	RoleWorkspace: 60,
}

func NormalizeScope(input ScopeDescriptor) (ScopeDescriptor, error) {
	out := ScopeDescriptor{
		Kind:       input.Kind,
		Principals: make([]ScopePrincipal, 0, len(input.Principals)),
	}
	for _, principal := range input.Principals {
		role := PrincipalRole(strings.TrimSpace(string(principal.Role)))
		id := strings.TrimSpace(principal.ID)
		if role == "" || id == "" {
			return ScopeDescriptor{}, fmt.Errorf("scope principals require non-empty role and id")
		}
		if _, ok := roleOrder[role]; !ok {
			return ScopeDescriptor{}, fmt.Errorf("unsupported principal role %q", role)
		}
		out.Principals = append(out.Principals, ScopePrincipal{Role: role, ID: id})
	}
	if err := validateScopeShape(out); err != nil {
		return ScopeDescriptor{}, err
	}
	sort.Slice(out.Principals, func(i, j int) bool {
		left := out.Principals[i]
		right := out.Principals[j]
		if roleOrder[left.Role] == roleOrder[right.Role] {
			if left.ID == right.ID {
				return string(left.Role) < string(right.Role)
			}
			return left.ID < right.ID
		}
		return roleOrder[left.Role] < roleOrder[right.Role]
	})
	if err := validatePrincipalSet(out); err != nil {
		return ScopeDescriptor{}, err
	}
	return out, nil
}

func validateScopeShape(input ScopeDescriptor) error {
	switch input.Kind {
	case ScopeSingleton, ScopeGroup:
		if len(input.Principals) != 1 {
			return fmt.Errorf("%s scope requires exactly one principal", input.Kind)
		}
	case ScopePair, ScopeAppPrivate, ScopeWorkspacePrivate:
		if len(input.Principals) != 2 {
			return fmt.Errorf("%s scope requires exactly two principals", input.Kind)
		}
	default:
		return fmt.Errorf("unsupported scope kind %q", input.Kind)
	}
	return nil
}

func validatePrincipalSet(input ScopeDescriptor) error {
	seen := make(map[PrincipalRole]struct{}, len(input.Principals))
	for _, principal := range input.Principals {
		if _, ok := seen[principal.Role]; ok {
			return fmt.Errorf("duplicate principal role %q", principal.Role)
		}
		seen[principal.Role] = struct{}{}
	}
	switch input.Kind {
	case ScopeSingleton:
		return nil
	case ScopePair:
		return nil
	case ScopeGroup:
		return nil
	case ScopeAppPrivate:
		return requireRoles(input, RoleAccount, RoleApp)
	case ScopeWorkspacePrivate:
		return requireRoles(input, RoleAccount, RoleWorkspace)
	default:
		return fmt.Errorf("unsupported scope kind %q", input.Kind)
	}
}

func requireRoles(input ScopeDescriptor, expected ...PrincipalRole) error {
	if len(input.Principals) != len(expected) {
		return fmt.Errorf("%s scope requires %d principals", input.Kind, len(expected))
	}
	for _, role := range expected {
		found := false
		for _, principal := range input.Principals {
			if principal.Role == role {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("%s scope requires role %q", input.Kind, role)
		}
	}
	return nil
}
