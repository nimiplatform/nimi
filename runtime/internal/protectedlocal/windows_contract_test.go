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
	if principal.ServiceSID() != mustActiveWindowsRuntimeProfile().serviceSID {
		t.Fatalf("service SID = %q", principal.ServiceSID())
	}

	tests := map[string]struct {
		stage  WindowsPrincipalFailureStage
		mutate func(*windowsPrincipalSnapshot)
	}{
		"different service SID": {stage: WindowsPrincipalStageResolvedSID, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.ResolvedServiceSID = "S-1-5-80-1-2-3-4-5"
		}},
		"different service host": {stage: WindowsPrincipalStageServiceHostAccount, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.ServiceStartName = "NT AUTHORITY\\LocalService"
		}},
		"different service host token user": {stage: WindowsPrincipalStageTokenUser, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.TokenUserSID = "S-1-5-19"
		}},
		"unrestricted SCM service": {stage: WindowsPrincipalStageServiceSIDType, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.ServiceSIDType = 1
		}},
		"interactive service definition": {stage: WindowsPrincipalStageInteractiveService, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.InteractiveService = true
		}},
		"impersonation token": {stage: WindowsPrincipalStagePrimaryToken, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.TokenType = 2
		}},
		"interactive session": {stage: WindowsPrincipalStageSessionZero, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.TokenSessionID = 2
		}},
		"unrestricted token": {stage: WindowsPrincipalStageRestrictedToken, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.TokenRestricted = false
		}},
		"service SID missing from groups": {stage: WindowsPrincipalStageServiceSIDGroup, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = snapshot.Groups[1:]
		}},
		"service SID deny only": {stage: WindowsPrincipalStageServiceSIDGroup, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups[0].Attributes = windowsGroupUseForDenyOnly
		}},
		"service SID missing from restrictions": {stage: WindowsPrincipalStageRestrictedSIDList, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.RestrictedSIDs = nil
		}},
		"service logon SID missing": {stage: WindowsPrincipalStageServiceLogonGroup, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = snapshot.Groups[:1]
		}},
		"interactive group present": {stage: WindowsPrincipalStageInteractiveGroup, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = append(snapshot.Groups, windowsSIDAttributes{SID: windowsInteractiveLogonSID, Attributes: windowsGroupEnabled})
		}},
		"remote interactive group present": {stage: WindowsPrincipalStageInteractiveGroup, mutate: func(snapshot *windowsPrincipalSnapshot) {
			snapshot.Groups = append(snapshot.Groups, windowsSIDAttributes{SID: windowsRemoteInteractiveLogonSID, Attributes: windowsGroupEnabled})
		}},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			snapshot := validWindowsPrincipalSnapshot()
			test.mutate(&snapshot)
			_, err := validateWindowsPrincipalSnapshot(snapshot)
			if !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
				t.Fatalf("error = %v, want principal-required", err)
			}
			if stage, ok := WindowsPrincipalStageFromError(err); !ok || stage != test.stage {
				t.Fatalf("principal stage = (%v, %v), want %v", stage, ok, test.stage)
			}
			if code, ok := WindowsPrincipalStartupExitCode(err); !ok || code != WindowsPrincipalStartupExitCodeBase+uint32(test.stage) {
				t.Fatalf("principal startup exit code = (%x, %v), want %x", code, ok, WindowsPrincipalStartupExitCodeBase+uint32(test.stage))
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
	serviceSID := mustActiveWindowsRuntimeProfile().serviceSID
	return windowsPrincipalSnapshot{
		ResolvedServiceSID: serviceSID,
		ServiceStartName:   WindowsServiceHostAccount,
		TokenUserSID:       WindowsServiceHostSID,
		TokenSessionID:     0,
		TokenType:          windowsTokenPrimary,
		TokenRestricted:    true,
		ServiceSIDType:     windowsServiceSIDTypeRestricted,
		Groups: []windowsSIDAttributes{
			{SID: serviceSID, Attributes: windowsGroupEnabled},
			{SID: windowsServiceLogonSID, Attributes: windowsGroupEnabled},
		},
		RestrictedSIDs: []windowsSIDAttributes{
			{SID: serviceSID},
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
