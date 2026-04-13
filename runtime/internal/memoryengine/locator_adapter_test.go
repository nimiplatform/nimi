package memoryengine

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestNormalizeScopeSortsPairRolesDeterministically(t *testing.T) {
	scope, err := NormalizeScope(ScopeDescriptor{
		Kind: ScopePair,
		Principals: []ScopePrincipal{
			{Role: RoleUser, ID: "user-1"},
			{Role: RoleAgent, ID: "agent-1"},
		},
	})
	if err != nil {
		t.Fatalf("NormalizeScope: %v", err)
	}
	if got, want := scope.Principals[0].Role, RoleAgent; got != want {
		t.Fatalf("principal[0].Role = %q, want %q", got, want)
	}
	if got, want := scope.Principals[1].Role, RoleUser; got != want {
		t.Fatalf("principal[1].Role = %q, want %q", got, want)
	}
}

func TestScopeFromAndToMemoryBankLocatorRoundTrip(t *testing.T) {
	tests := []struct {
		name string
		in   *runtimev1.MemoryBankLocator
		key  string
	}{
		{
			name: "agent_core",
			in: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
				Owner: &runtimev1.MemoryBankLocator_AgentCore{
					AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-a"},
				},
			},
			key: "agent-core::agent-a",
		},
		{
			name: "agent_dyadic",
			in: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
				Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
					AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: "agent-a", UserId: "user-b"},
				},
			},
			key: "agent-dyadic::agent-a::user-b",
		},
		{
			name: "world_shared",
			in: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
				Owner: &runtimev1.MemoryBankLocator_WorldShared{
					WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-z"},
				},
			},
			key: "world-shared::world-z",
		},
		{
			name: "app_private",
			in: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE,
				Owner: &runtimev1.MemoryBankLocator_AppPrivate{
					AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-1", AppId: "app-1"},
				},
			},
			key: "app-private::acct-1::app-1",
		},
		{
			name: "workspace_private",
			in: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE,
				Owner: &runtimev1.MemoryBankLocator_WorkspacePrivate{
					WorkspacePrivate: &runtimev1.WorkspacePrivateBankOwner{AccountId: "acct-1", WorkspaceId: "ws-1"},
				},
			},
			key: "workspace-private::acct-1::ws-1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scope, err := ScopeFromMemoryBankLocator(tt.in)
			if err != nil {
				t.Fatalf("ScopeFromMemoryBankLocator: %v", err)
			}
			key, err := LocatorKey(scope)
			if err != nil {
				t.Fatalf("LocatorKey: %v", err)
			}
			if key != tt.key {
				t.Fatalf("LocatorKey = %q, want %q", key, tt.key)
			}
			out, err := ScopeToMemoryBankLocator(scope)
			if err != nil {
				t.Fatalf("ScopeToMemoryBankLocator: %v", err)
			}
			if out.String() != tt.in.String() {
				t.Fatalf("round trip locator = %s, want %s", out.String(), tt.in.String())
			}
		})
	}
}

func TestNormalizeScopeRejectsIllegalRoleCombinations(t *testing.T) {
	_, err := NormalizeScope(ScopeDescriptor{
		Kind: ScopeAppPrivate,
		Principals: []ScopePrincipal{
			{Role: RoleAgent, ID: "agent-1"},
			{Role: RoleWorld, ID: "world-1"},
		},
	})
	if err == nil {
		t.Fatal("expected NormalizeScope to fail for illegal app-private role set")
	}
}

func TestLocatorKeyFailsForGenericShapeWithoutCurrentNimiRoles(t *testing.T) {
	scope, err := NormalizeScope(ScopeDescriptor{
		Kind: ScopeSingleton,
		Principals: []ScopePrincipal{
			{Role: RoleWorld, ID: "world-1"},
		},
	})
	if err != nil {
		t.Fatalf("NormalizeScope: %v", err)
	}
	if _, err := LocatorKey(scope); err == nil {
		t.Fatal("expected LocatorKey to reject singleton scope without agent role")
	}
}

func TestOwnerFilterKeyMatchesCurrentNimiEncoding(t *testing.T) {
	filter := &runtimev1.MemoryBankOwnerFilter{
		Owner: &runtimev1.MemoryBankOwnerFilter_AgentDyadic{
			AgentDyadic: &runtimev1.AgentDyadicBankOwner{
				AgentId: "agent-a",
				UserId:  "user-b",
			},
		},
	}
	got, err := OwnerFilterKey(filter)
	if err != nil {
		t.Fatalf("OwnerFilterKey: %v", err)
	}
	if want := "agent-dyadic::agent-a::user-b"; got != want {
		t.Fatalf("OwnerFilterKey = %q, want %q", got, want)
	}
}

func TestScopeFromLocatorKeyAndBackToLocator(t *testing.T) {
	tests := []struct {
		name string
		key  string
		want *runtimev1.MemoryBankLocator
	}{
		{
			name: "agent_core",
			key:  "agent-core::agent-a",
			want: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
				Owner: &runtimev1.MemoryBankLocator_AgentCore{
					AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-a"},
				},
			},
		},
		{
			name: "agent_dyadic",
			key:  "agent-dyadic::agent-a::user-b",
			want: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
				Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
					AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: "agent-a", UserId: "user-b"},
				},
			},
		},
		{
			name: "world_shared",
			key:  "world-shared::world-z",
			want: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
				Owner: &runtimev1.MemoryBankLocator_WorldShared{
					WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-z"},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scope, err := ScopeFromLocatorKey(tt.key)
			if err != nil {
				t.Fatalf("ScopeFromLocatorKey: %v", err)
			}
			got, err := ScopeToMemoryBankLocator(scope)
			if err != nil {
				t.Fatalf("ScopeToMemoryBankLocator: %v", err)
			}
			if got.String() != tt.want.String() {
				t.Fatalf("ScopeFromLocatorKey/ScopeToMemoryBankLocator = %s, want %s", got.String(), tt.want.String())
			}
			direct, err := LocatorKeyToMemoryBankLocator(tt.key)
			if err != nil {
				t.Fatalf("LocatorKeyToMemoryBankLocator: %v", err)
			}
			if direct.String() != tt.want.String() {
				t.Fatalf("LocatorKeyToMemoryBankLocator = %s, want %s", direct.String(), tt.want.String())
			}
		})
	}
}
