package protectedlocal

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestWindowsPrincipalSnapshotRequiresExactRestrictedNonInteractiveService(t *testing.T) {
	valid := validWindowsPrincipalSnapshot()
	principal, err := validateWindowsPrincipalSnapshot(valid)
	if err != nil {
		t.Fatalf("valid snapshot rejected: %v", err)
	}
	if principal.ServiceSID() != WindowsProductionServiceSID {
		t.Fatalf("service SID = %q", principal.ServiceSID())
	}

	tests := map[string]func(*windowsPrincipalSnapshot){
		"different service SID": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.ResolvedServiceSID = "S-1-5-80-1-2-3-4-5"
		},
		"unrestricted SCM service": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.ServiceSIDType = 1
		},
		"interactive service definition": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.InteractiveService = true
		},
		"impersonation token": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.TokenType = 2
		},
		"interactive session": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.TokenSessionID = 2
		},
		"unrestricted token": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.TokenRestricted = false
		},
		"service SID missing from groups": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = snapshot.Groups[1:]
		},
		"service SID deny only": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups[0].Attributes = windowsGroupUseForDenyOnly
		},
		"service SID missing from restrictions": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.RestrictedSIDs = nil
		},
		"service logon SID missing": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = snapshot.Groups[:1]
		},
		"interactive group present": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = append(snapshot.Groups, windowsSIDAttributes{SID: windowsInteractiveLogonSID, Attributes: windowsGroupEnabled})
		},
		"remote interactive group present": func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = append(snapshot.Groups, windowsSIDAttributes{SID: windowsRemoteInteractiveLogonSID, Attributes: windowsGroupEnabled})
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			snapshot := validWindowsPrincipalSnapshot()
			mutate(&snapshot)
			_, err := validateWindowsPrincipalSnapshot(snapshot)
			if !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
				t.Fatalf("error = %v, want principal-required", err)
			}
		})
	}
}

func TestWindowsServiceAnchorStoreAndLedgerKeyUseBinaryCustody(t *testing.T) {
	ctx := context.Background()
	secrets := &memoryBinarySecrets{values: map[string][]byte{}}
	anchorStore, err := NewWindowsServiceAnchorStore(secrets)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := anchorStore.Load(ctx); !errors.Is(err, ErrAnchorNotFound) {
		t.Fatalf("missing anchor error = %v", err)
	}
	anchor := Anchor{
		LedgerUUID:      Identifier{1, 2, 3},
		CommitSequence:  42,
		CommitChainHead: Identifier{9, 8, 7},
	}
	if err := anchorStore.Store(ctx, anchor); err != nil {
		t.Fatal(err)
	}
	loaded, err := anchorStore.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if loaded != anchor {
		t.Fatalf("anchor = %#v, want %#v", loaded, anchor)
	}

	first, err := LoadOrCreateWindowsLedgerRecordMACKey(ctx, secrets)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadOrCreateWindowsLedgerRecordMACKey(ctx, secrets)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 32 || string(first) != string(second) {
		t.Fatal("ledger key was not stable in protected custody")
	}
	if _, present := secrets.values[WindowsLedgerRecordMACKeyName]; !present {
		t.Fatal("ledger key was not stored through binary custody")
	}
}

func TestWindowsLogicalSecretNamesAreNotPaths(t *testing.T) {
	for _, name := range []string{"account.session-1", "provider-key.v1", "a"} {
		if err := validateWindowsSecretName(name); err != nil {
			t.Fatalf("valid name %q rejected: %v", name, err)
		}
	}
	for _, name := range []string{"", "../token", `account\\token`, "Account", ".hidden", "token_1", "token/1"} {
		if err := validateWindowsSecretName(name); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
			t.Fatalf("invalid name %q error = %v", name, err)
		}
	}
}

func validWindowsPrincipalSnapshot() windowsPrincipalSnapshot {
	return windowsPrincipalSnapshot{
		ResolvedServiceSID: WindowsProductionServiceSID,
		TokenUserSID:       "S-1-5-18",
		TokenSessionID:     0,
		TokenType:          windowsTokenPrimary,
		TokenRestricted:    true,
		ServiceSIDType:     windowsServiceSIDTypeRestricted,
		Groups: []windowsSIDAttributes{
			{SID: WindowsProductionServiceSID, Attributes: windowsGroupEnabled},
			{SID: windowsServiceLogonSID, Attributes: windowsGroupEnabled},
		},
		RestrictedSIDs: []windowsSIDAttributes{
			{SID: WindowsProductionServiceSID},
		},
	}
}

type memoryBinarySecrets struct {
	mu     sync.Mutex
	values map[string][]byte
}

func (store *memoryBinarySecrets) Load(_ context.Context, name string) ([]byte, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	value, ok := store.values[name]
	if !ok {
		return nil, ErrProtectedSecretNotFound
	}
	return append([]byte(nil), value...), nil
}

func (store *memoryBinarySecrets) Store(_ context.Context, name string, value []byte) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.values[name] = append([]byte(nil), value...)
	return nil
}

func (store *memoryBinarySecrets) Delete(_ context.Context, name string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, ok := store.values[name]; !ok {
		return ErrProtectedSecretNotFound
	}
	delete(store.values, name)
	return nil
}
