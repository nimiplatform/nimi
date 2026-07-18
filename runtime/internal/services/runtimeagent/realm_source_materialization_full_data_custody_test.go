//go:build realm_v3_full_data

package runtimeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

type realmV3FullDataAccountCustodySnapshotV1 struct {
	SchemaVersion        string                                     `json:"schemaVersion"`
	AccountID            string                                     `json:"accountId"`
	DisplayName          string                                     `json:"displayName"`
	RealmEnvironmentID   string                                     `json:"realmEnvironmentId"`
	WorkspaceMemberships []*runtimev1.WorkspaceMembershipProjection `json:"workspaceMemberships,omitempty"`
	AccessToken          string                                     `json:"accessToken"`
	AccessTokenExpires   string                                     `json:"accessTokenExpires"`
	RefreshToken         string                                     `json:"refreshToken"`
	RefreshTokenHashes   map[string]bool                            `json:"refreshTokenHashes,omitempty"`
}

type realmV3FullDataSharedAccountCustodyV1 struct {
	mu   sync.Mutex
	path string
}

func (custody *realmV3FullDataSharedAccountCustodyV1) Load(_ context.Context, _ string) (accountservice.AccountMaterial, error) {
	custody.mu.Lock()
	defer custody.mu.Unlock()
	info, err := os.Lstat(custody.path)
	if errors.Is(err, os.ErrNotExist) {
		return accountservice.AccountMaterial{}, accountservice.ErrNoStoredAccount
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 {
		return accountservice.AccountMaterial{}, accountservice.ErrCustodyUnavailable
	}
	raw, err := os.ReadFile(custody.path)
	if err != nil || len(raw) > 1<<20 {
		return accountservice.AccountMaterial{}, accountservice.ErrCustodyUnavailable
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var snapshot realmV3FullDataAccountCustodySnapshotV1
	if err := decoder.Decode(&snapshot); err != nil || decoder.Decode(&struct{}{}) != io.EOF ||
		snapshot.SchemaVersion != realmV3FullDataAccountCustodySchemaV1 {
		return accountservice.AccountMaterial{}, accountservice.ErrCustodyUnavailable
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, snapshot.AccessTokenExpires)
	if err != nil {
		return accountservice.AccountMaterial{}, accountservice.ErrCustodyUnavailable
	}
	return accountservice.AccountMaterial{
		AccountID: snapshot.AccountID, DisplayName: snapshot.DisplayName,
		RealmEnvironmentID: snapshot.RealmEnvironmentID, WorkspaceMemberships: snapshot.WorkspaceMemberships,
		AccessToken: snapshot.AccessToken, AccessTokenExpires: expiresAt.UTC(),
		RefreshToken: snapshot.RefreshToken, RefreshTokenHashes: snapshot.RefreshTokenHashes,
	}, nil
}

func (custody *realmV3FullDataSharedAccountCustodyV1) Store(_ context.Context, _ string, material accountservice.AccountMaterial) error {
	custody.mu.Lock()
	defer custody.mu.Unlock()
	if strings.TrimSpace(material.AccountID) == "" || strings.TrimSpace(material.AccessToken) == "" ||
		strings.TrimSpace(material.RefreshToken) == "" || material.AccessTokenExpires.IsZero() {
		return accountservice.ErrCustodyUnavailable
	}
	snapshot := realmV3FullDataAccountCustodySnapshotV1{
		SchemaVersion: realmV3FullDataAccountCustodySchemaV1,
		AccountID:     material.AccountID, DisplayName: material.DisplayName,
		RealmEnvironmentID: material.RealmEnvironmentID, WorkspaceMemberships: material.WorkspaceMemberships,
		AccessToken: material.AccessToken, AccessTokenExpires: material.AccessTokenExpires.UTC().Format(time.RFC3339Nano),
		RefreshToken: material.RefreshToken, RefreshTokenHashes: material.RefreshTokenHashes,
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	temporary := fmt.Sprintf("%s.tmp-%d-%d", custody.path, os.Getpid(), time.Now().UnixNano())
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	ok := false
	defer func() {
		_ = file.Close()
		if !ok {
			_ = os.Remove(temporary)
		}
	}()
	if _, err := file.Write(append(raw, '\n')); err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	if err := file.Sync(); err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	if err := file.Close(); err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	if err := os.Rename(temporary, custody.path); err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	if err := os.Chmod(custody.path, 0o600); err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	if err := syncRealmV3FullDataParentDirectoryV1(custody.path); err != nil {
		return accountservice.ErrCustodyUnavailable
	}
	ok = true
	return nil
}

func (custody *realmV3FullDataSharedAccountCustodyV1) Clear(_ context.Context, _ string) error {
	custody.mu.Lock()
	defer custody.mu.Unlock()
	paths, err := custody.ownedResiduePathsLocked()
	if err != nil {
		return err
	}
	for _, target := range paths {
		if err := os.Remove(target); err != nil {
			return accountservice.ErrCustodyUnavailable
		}
	}
	if len(paths) != 0 {
		if err := syncRealmV3FullDataParentDirectoryV1(custody.path); err != nil {
			return accountservice.ErrCustodyUnavailable
		}
	}
	remaining, err := custody.ownedResiduePathsLocked()
	if err != nil || len(remaining) != 0 {
		return accountservice.ErrCustodyUnavailable
	}
	return nil
}

func (custody *realmV3FullDataSharedAccountCustodyV1) residue() (uint64, error) {
	custody.mu.Lock()
	defer custody.mu.Unlock()
	paths, err := custody.ownedResiduePathsLocked()
	if err != nil {
		return 0, err
	}
	return uint64(len(paths)), nil
}

func (custody *realmV3FullDataSharedAccountCustodyV1) ownedResiduePathsLocked() ([]string, error) {
	if custody == nil || strings.TrimSpace(custody.path) == "" {
		return nil, accountservice.ErrCustodyUnavailable
	}
	directory := filepath.Dir(custody.path)
	base := filepath.Base(custody.path)
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, accountservice.ErrCustodyUnavailable
	}
	paths := make([]string, 0, 2)
	for _, entry := range entries {
		name := entry.Name()
		if name != base && !(strings.HasPrefix(name, base+".tmp-") && len(name) > len(base+".tmp-")) {
			continue
		}
		target := filepath.Join(directory, name)
		info, err := os.Lstat(target)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 {
			return nil, accountservice.ErrCustodyUnavailable
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || int(stat.Uid) != os.Geteuid() {
			return nil, accountservice.ErrCustodyUnavailable
		}
		paths = append(paths, target)
	}
	return paths, nil
}

func realmV3FullDataCustodyV1(runtimeRoot string) *realmV3FullDataSharedAccountCustodyV1 {
	return &realmV3FullDataSharedAccountCustodyV1{path: filepath.Join(runtimeRoot, realmV3FullDataAccountCustodyFileV1)}
}

func initializeRealmV3FullDataAccountCustodyV1(t *testing.T, custody *realmV3FullDataSharedAccountCustodyV1) string {
	t.Helper()
	accountID := strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_ACCOUNT_ID"))
	if accountID == "" {
		t.Fatal("mandatory current Realm account identity is missing")
	}
	material, err := custody.Load(context.Background(), "")
	if err == nil {
		if material.AccountID != accountID {
			t.Fatal("shared full-data custody belongs to a different account")
		}
		return accountID
	}
	if !errors.Is(err, accountservice.ErrNoStoredAccount) {
		t.Fatalf("load shared full-data account custody: %v", err)
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_ACCESS_EXPIRES_AT")))
	if err != nil {
		t.Fatalf("parse current Realm access expiry: %v", err)
	}
	initial := accountservice.AccountMaterial{
		AccountID: accountID, DisplayName: "Realm v3 full-data acceptance", RealmEnvironmentID: "realm-v3-full-data",
		AccessToken: strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_BEARER")), AccessTokenExpires: expiresAt.UTC(),
		RefreshToken: strings.TrimSpace(os.Getenv("NIMI_REALM_V3_LIVE_REFRESH_TOKEN")),
	}
	if initial.AccessToken == "" || initial.RefreshToken == "" {
		t.Fatal("mandatory current Realm account credentials are missing")
	}
	if err := custody.Store(context.Background(), "", initial); err != nil {
		t.Fatalf("initialize shared full-data account custody: %v", err)
	}
	return accountID
}

func openRealmV3FullDataRuntimeServiceV1(t *testing.T, runtimeRoot, inputDigest string) (*Service, func()) {
	t.Helper()
	localStatePath := filepath.Join(runtimeRoot, realmV3FullDataLocalStateFileV1)
	memoryService, err := memoryservice.New(nil, config.Config{LocalStatePath: localStatePath, AIHTTPTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("open full-data shared Runtime memory: %v", err)
	}
	service, err := New(nil, localStatePath, memoryService)
	if err != nil {
		_ = memoryService.Close()
		t.Fatalf("open full-data shared RuntimeAgent: %v", err)
	}
	runtimeID := "realm-v3-full-data-" + inputDigest
	if err := service.SetSourceMaterializationRuntimeIdentity(runtimeID); err != nil {
		service.Close()
		_ = memoryService.Close()
		t.Fatalf("bind full-data Runtime identity: %v", err)
	}
	var once sync.Once
	return service, func() {
		once.Do(func() {
			service.Close()
			if err := memoryService.Close(); err != nil {
				t.Fatalf("close full-data Runtime memory: %v", err)
			}
		})
	}
}
