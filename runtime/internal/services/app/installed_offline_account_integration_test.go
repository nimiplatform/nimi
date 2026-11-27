package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type d1d5MemorySecretStore struct {
	mu      sync.Mutex
	secrets map[string][]byte
}

func newD1D5MemorySecretStore() *d1d5MemorySecretStore {
	return &d1d5MemorySecretStore{secrets: make(map[string][]byte)}
}

func (s *d1d5MemorySecretStore) Load(_ context.Context, name string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, ok := s.secrets[name]
	if !ok {
		return nil, protectedlocal.ErrProtectedSecretNotFound
	}
	return append([]byte(nil), raw...), nil
}

func (s *d1d5MemorySecretStore) Store(_ context.Context, name string, value []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.secrets[name] = append([]byte(nil), value...)
	return nil
}

func (s *d1d5MemorySecretStore) Delete(_ context.Context, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.secrets[name]; !ok {
		return protectedlocal.ErrProtectedSecretNotFound
	}
	delete(s.secrets, name)
	return nil
}

type d1d5RegistryTransport struct {
	mu            sync.Mutex
	appID         string
	revision      string
	revSeq        uint64
	documents     map[string][]byte
	assetURL      string
	asset         []byte
	offline       bool
	blocked       bool
	killSwitchRev uint64
}

func (tr *d1d5RegistryTransport) setOffline(offline bool) {
	tr.mu.Lock()
	tr.offline = offline
	tr.mu.Unlock()
}

func (tr *d1d5RegistryTransport) setBlocked(blocked bool) {
	tr.mu.Lock()
	tr.blocked = blocked
	tr.killSwitchRev++
	tr.revSeq++
	tr.revision = fmt.Sprintf("%040x", 0x3000+tr.revSeq)
	tr.mu.Unlock()
}

func (tr *d1d5RegistryTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	tr.mu.Lock()
	offline := tr.offline
	blocked := tr.blocked
	killSwitchRev := tr.killSwitchRev
	revision := tr.revision
	documents := tr.documents
	assetURL := tr.assetURL
	asset := tr.asset
	appID := tr.appID
	tr.mu.Unlock()

	if offline {
		return nil, errors.New("simulated registry unreachable")
	}
	if request.URL.String() == "https://github.com/nimiplatform/nimi-app-registry.git/info/refs?service=git-upload-pack" {
		ref := revision + " refs/heads/main\x00object-format=sha1\n"
		adv := fmt.Sprintf("001e# service=git-upload-pack\n0000%04x%s0000", len(ref)+4, ref)
		resp := &http.Response{
			StatusCode: http.StatusOK, Status: http.StatusText(http.StatusOK), Header: make(http.Header),
			Body: io.NopCloser(strings.NewReader(adv)), ContentLength: int64(len(adv)), Request: request,
		}
		resp.Header.Set("Content-Type", "application/x-git-upload-pack-advertisement")
		return resp, nil
	}
	if request.URL.Host == "raw.githubusercontent.com" {
		prefix := "/nimiplatform/nimi-app-registry/" + revision + "/"
		path := strings.TrimPrefix(request.URL.Path, prefix)
		raw, ok := documents[path]
		if !ok || path == request.URL.Path {
			return &http.Response{StatusCode: http.StatusNotFound, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(nil)), Request: request}, nil
		}
		if path == "index.json" && killSwitchRev > 0 {
			var index map[string]any
			if err := json.Unmarshal(raw, &index); err != nil {
				return nil, err
			}
			apps := index["apps"].(map[string]any)
			row := apps[appID].(map[string]any)
			var reason any
			if blocked {
				reason = "security-review-revoked"
			}
			row["kill_switch"] = map[string]any{"active": blocked, "reason": reason, "revision": killSwitchRev}
			raw, _ = json.Marshal(index)
		}
		return &http.Response{
			StatusCode: http.StatusOK, Status: http.StatusText(http.StatusOK), Header: make(http.Header),
			Body: io.NopCloser(bytes.NewReader(raw)), ContentLength: int64(len(raw)), Request: request,
		}, nil
	}
	if request.URL.String() == assetURL {
		return &http.Response{
			StatusCode: http.StatusOK, Status: http.StatusText(http.StatusOK), Header: make(http.Header),
			Body: io.NopCloser(bytes.NewReader(asset)), ContentLength: int64(len(asset)), Request: request,
		}, nil
	}
	return &http.Response{StatusCode: http.StatusNotFound, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(nil)), Request: request}, nil
}

type d1d5RealmTransport struct {
	mu           sync.Mutex
	offline      bool
	refreshFn    func(*http.Request) (*http.Response, error)
	refreshCalls atomic.Int32
	apiCalls     atomic.Int32
}

func (tr *d1d5RealmTransport) setOffline(offline bool) {
	tr.mu.Lock()
	tr.offline = offline
	tr.mu.Unlock()
}

func (tr *d1d5RealmTransport) setRefreshFn(fn func(*http.Request) (*http.Response, error)) {
	tr.mu.Lock()
	tr.refreshFn = fn
	tr.mu.Unlock()
}

func (tr *d1d5RealmTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	tr.mu.Lock()
	offline := tr.offline
	refreshFn := tr.refreshFn
	tr.mu.Unlock()

	if req.URL.Path == realmv1.RefreshTokenOperation.Path() {
		tr.refreshCalls.Add(1)
		if offline {
			return nil, errors.New("dial tcp: realm network unreachable")
		}
		if refreshFn != nil {
			return refreshFn(req)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"accessToken":"access-fresh","refreshToken":"refresh-fresh","tokenType":"Bearer","expiresIn":300}`)),
			Request:    req,
		}, nil
	}
	tr.apiCalls.Add(1)
	if offline {
		return nil, errors.New("dial tcp: realm network unreachable")
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`[{"id":"world-1"}]`)),
		Request:    req,
	}, nil
}

func buildD1D5ManagedWebAppInfoJSON(t *testing.T, appID, version string) []byte {
	t.Helper()
	icon := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	icon.Set(64, 64, color.NRGBA{R: 35, G: 165, B: 220, A: 255})
	var iconBuf bytes.Buffer
	if err := png.Encode(&iconBuf, icon); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(nimiapppackage.AppInfo{
		Format:                          "nimi.app-info/v1",
		AppID:                           appID,
		Version:                         version,
		TargetID:                        nimiapppackage.ManagedWebTargetID,
		DisplayName:                     "Offline D1D5 App",
		Summary:                         "Verified App for D1xD5 offline integration test.",
		Icon:                            nimiapppackage.AppInfoIcon{MediaType: "image/png", DataBase64: base64.StdEncoding.EncodeToString(iconBuf.Bytes())},
		ReadmeMarkdown:                  "Offline integration test App.",
		ReleaseNotesMarkdown:            "Release " + version,
		License:                         nimiapppackage.AppInfoLicense{Identifier: "MIT", Text: "MIT\n"},
		AppAccess:                       []string{"runtime.consume"},
		CapabilityContractRefs:          []string{},
		RequiredStandardizedFeatureRefs: []string{},
		StoragePolicy:                   nimiapppackage.AppInfoStoragePolicy{Kind: "nimi-mediated-default"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func buildD1D5ManagedWebPackage(t *testing.T, appID, version string) []byte {
	t.Helper()
	appInfoBytes := buildD1D5ManagedWebAppInfoJSON(t, appID, version)
	manifestBytes, err := json.Marshal(map[string]any{
		"format":        "nimi.app-package/v2",
		"app_id":        appID,
		"version":       version,
		"target_id":     nimiapppackage.ManagedWebTargetID,
		"os":            "any",
		"arch":          "any",
		"runtime_entry": nimiapppackage.ManagedWebRuntimeEntry,
		"native_trust": map[string]any{
			"posture":             "nimi-managed-carrier",
			"certificate_subject": nil,
		},
		"execution_profile": map[string]any{
			"launch_mode": nimiapppackage.ManagedWebExecutionProfileRef,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	type entry struct {
		name string
		data []byte
	}
	entries := []entry{
		{"LICENSE", []byte("MIT\n")},
		{"app-info.json", appInfoBytes},
		{"manifest.json", manifestBytes},
		{"nimi.app.yaml", []byte("app_id: " + appID + "\nversion: " + version + "\ndisplay_name: Offline D1D5 App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\n")},
		{"payload/assets/app.js", []byte("console.log('d1d5');\n")},
		{nimiapppackage.ManagedWebRuntimeEntry, []byte("<!doctype html><html><body>offline d1d5</body></html>")},
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, e := range entries {
		h := &zip.FileHeader{
			Name: e.name, Method: zip.Store, Flags: 0x0800,
			CreatorVersion: 0x0314, ReaderVersion: 20, CRC32: crc32.ChecksumIEEE(e.data),
			CompressedSize: uint32(len(e.data)), UncompressedSize: uint32(len(e.data)),
			CompressedSize64: uint64(len(e.data)), UncompressedSize64: uint64(len(e.data)),
			ExternalAttrs: (0o100644) << 16,
		}
		w, err := zw.CreateRaw(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(e.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func buildD1D5ManagedWebRegistryDocs(t *testing.T, appID, version string, pkgBytes []byte, assetName, assetURL, repo string) map[string][]byte {
	t.Helper()
	mustJSON := func(v any) []byte {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	pkgSHA := sha256.Sum256(pkgBytes)
	pkgSHAHex := hex.EncodeToString(pkgSHA[:])
	descriptorID := appID + "@" + version
	descriptorPath := "descriptors/" + appID + "/" + version + ".json"
	tag := "v" + version
	sourceCommit := strings.Repeat("c", 40)

	infoRaw := buildD1D5ManagedWebAppInfoJSON(t, appID, version)
	infoSHA := sha256.Sum256(infoRaw)
	infoName := appID + "-" + version + "-" + publicappregistry.ManagedWebTargetID + ".app-info.json"

	descriptor := map[string]any{
		"schema_version":       1,
		"descriptor_id":        descriptorID,
		"publisher_submission": map[string]any{"pull_number": 9, "path": "submissions/publisher/" + appID + "/" + version + ".json", "head_sha": sourceCommit},
		"admission": map[string]any{
			"ordinary_release_proof": true, "trust_tier": "community", "build_assurance": "developer-attested",
			"dependency_assurance": map[string]any{"lockfile_reviewed": true, "sbom_ref": nil},
			"review":               map[string]any{"decision": "approved", "adjudicator_login": "maintainer", "adjudicator_actor_id": 42, "reason_code": "approved-review", "decided_at": "2026-09-04T00:00:00Z"},
		},
		"candidate": map[string]any{
			"app_id": appID, "display_name": "Offline D1D5 App", "version": version,
			"publisher":  map[string]any{"github_namespace": "publisher", "namespace_kind": "organization", "assurance": "pseudonymous", "verified_domain_ref": nil, "kyc_ref": nil},
			"source":     map[string]any{"repository": repo, "license": map[string]any{"spdx_expression": "MIT", "files": []any{map[string]any{"path": "LICENSE", "sha256": strings.Repeat("1", 64)}}}},
			"release":    map[string]any{"tag": tag, "tag_protection_ref": "https://api.github.com/repos/publisher/d1d5-app/rulesets/1", "commit_sha": sourceCommit, "release_id": 31, "release_url": repo + "/releases/tag/" + tag, "release_notes_url": repo + "/releases/tag/" + tag, "immutable": true, "prerelease": false},
			"aggregate":  map[string]any{"asset_id": 200, "asset_name": "candidate.json", "asset_url": repo + "/releases/download/" + tag + "/candidate.json", "size": 10, "sha256": strings.Repeat("2", 64)},
			"package":    map[string]any{"kind": "nimiapp", "runtime_kind": "managed-web", "registration_mode": "app-managed", "sandbox_ref": publicappregistry.ManagedWebExecutionProfileRef},
			"app_access": []string{"runtime.consume"}, "capability_contract_refs": []string{}, "required_standardized_feature_refs": []string{},
			"storage_policy": map[string]any{"kind": "nimi-mediated-default", "os_storage_disclosure": nil},
			"update_channel": "stable", "rollback_marker": "none",
			"support": map[string]any{"diagnostics_bundle_fields": []string{}, "redaction_rules": []string{}, "issue_categories": []string{}, "escalation_url": repo + "/issues", "kill_switch_visibility": "visible", "recovery_instructions": "Reinstall."},
			"targets": []any{map[string]any{
				"target_id": publicappregistry.ManagedWebTargetID, "os": "any", "arch": "any", "asset_id": 201,
				"app_info":   map[string]any{"asset_id": 202, "asset_name": infoName, "asset_url": repo + "/releases/download/" + tag + "/" + infoName, "size": len(infoRaw), "sha256": hex.EncodeToString(infoSHA[:])},
				"asset_name": assetName, "asset_url": assetURL, "size": len(pkgBytes), "sha256": pkgSHAHex,
				"runtime_entry": publicappregistry.ManagedWebRuntimeEntry, "provenance_attestation_refs": []string{"https://api.github.com/repos/publisher/d1d5-app/attestations/sha256:" + pkgSHAHex},
				"execution_profile_ref": publicappregistry.ManagedWebExecutionProfileRef,
				"native_trust":          map[string]any{"signing_subject": nil, "observed_subject": nil, "entitlements_ref": nil, "windows_code_signing": "not-applicable", "macos_notarization": "not-applicable", "macos_developer_id_subject": nil},
			}},
		},
	}
	index := map[string]any{
		"schema_version": 1,
		"apps": map[string]any{appID: map[string]any{
			"display_name": "Offline D1D5 App", "visibility": "public", "admission_status": "approved",
			"kill_switch":                       map[string]any{"active": false, "reason": nil, "revision": 0},
			"latest_admitted_release_by_target": map[string]any{publicappregistry.ManagedWebTargetID: map[string]any{"descriptor_id": descriptorID, "path": descriptorPath}},
		}},
	}
	schema := func(id string) []byte {
		return mustJSON(map[string]any{"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": id, "type": "object"})
	}
	return map[string][]byte{
		"schema/common.schema.json":              schema("https://registry.nimi.ai/schema/common.schema.json"),
		"schema/index.schema.json":               schema("https://registry.nimi.ai/schema/index.schema.json"),
		"schema/approved-descriptor.schema.json": schema("https://registry.nimi.ai/schema/approved-descriptor.schema.json"),
		"index.json":                             mustJSON(index),
		descriptorPath:                           mustJSON(descriptor),
	}
}

type d1d5OfflineFixture struct {
	ctx               context.Context
	desktopCtx        context.Context
	desktopCaller     *runtimev1.AccountCaller
	handle            string
	registryTransport *d1d5RegistryTransport
	realmTransport    *d1d5RealmTransport
	accountSvc        *accountservice.Service
	appSvc            *Service
	childLiveness     func() *localAppSessionTestLiveness
}

func newD1D5OfflineColdStartFixture(t *testing.T, name string) *d1d5OfflineFixture {
	t.Helper()
	_, expectedOS, expectedArch, platformErr := publicappregistry.CurrentPlatformTarget()
	if platformErr != nil {
		t.Skip("requires admitted desktop platform")
	}

	ctx := context.Background()
	appID := "publisher.d1d5-app"
	version := "1.0.0"
	repo := "https://github.com/publisher/d1d5-app"
	assetName := appID + "-" + version + "-" + publicappregistry.ManagedWebTargetID + ".nimiapp"
	assetURL := repo + "/releases/download/v" + version + "/" + assetName
	pkgBytes := buildD1D5ManagedWebPackage(t, appID, version)
	docs := buildD1D5ManagedWebRegistryDocs(t, appID, version, pkgBytes, assetName, assetURL, repo)

	registryTransport := &d1d5RegistryTransport{
		appID:     appID,
		revision:  strings.Repeat("a", 40),
		documents: docs,
		assetURL:  assetURL,
		asset:     pkgBytes,
	}
	prevTransport := http.DefaultTransport
	http.DefaultTransport = registryTransport
	t.Cleanup(func() { http.DefaultTransport = prevTransport })

	var clockMu sync.Mutex
	currentTime := time.Date(2026, 11, 27, 8, 0, 0, 0, time.UTC)
	now := func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return currentTime
	}
	advance := func(d time.Duration) {
		clockMu.Lock()
		currentTime = currentTime.Add(d)
		clockMu.Unlock()
	}

	dataRoot := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	dbPath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}

	// Phase 0 (Online): install the verified App and persist its committed release
	// and verified policy approval in SQLite, then close kernel + coordinator to
	// force a genuine cold restart.
	installKernel, err := localappkernel.OpenSQLite(ctx, dbPath, identity, localappkernel.Options{
		HostInstallID: "d1d5-offline-host",
		DataRoot:      dataRoot,
		Now:           now,
	})
	if err != nil {
		t.Fatal(err)
	}
	installClient := publicappregistry.NewCanonicalClient()
	installCoordinator, err := nimiappinstall.NewCoordinator(installClient, installKernel, slog.New(slog.NewTextHandler(io.Discard, nil)), auditlog.New(64, 16))
	if err != nil {
		_ = installKernel.Close()
		t.Fatal(err)
	}
	installCoordinator.SetClock(now)
	snapshot, err := installClient.Load(ctx)
	if err != nil {
		_ = installCoordinator.Close()
		_ = installKernel.Close()
		t.Fatal(err)
	}
	resolved, err := snapshot.Resolve(ctx, appID, publicappregistry.ManagedWebTargetID, expectedOS, expectedArch)
	if err != nil {
		_ = installCoordinator.Close()
		_ = installKernel.Close()
		t.Fatal(err)
	}
	installed, err := installCoordinator.Install(ctx, resolved.Selector)
	if err != nil {
		_ = installCoordinator.Close()
		_ = installKernel.Close()
		t.Fatalf("install verified app: %v", err)
	}
	handle := installed.Registration.RegistrationHandle
	if err := installCoordinator.Close(); err != nil {
		_ = installKernel.Close()
		t.Fatal(err)
	}
	if err := installKernel.Close(); err != nil {
		t.Fatal(err)
	}

	// Phase (a): Cold-start OFFLINE 30 days later with both Registry and Realm
	// unreachable and persisted account custody whose Access Token has already
	// expired naturally.
	registryTransport.setOffline(true)
	advance(30 * 24 * time.Hour)

	realmBaseURL := "https://realm.d1d5.test"
	realmTransport := &d1d5RealmTransport{offline: true}
	realmHTTPClient := &http.Client{Transport: realmTransport}

	secrets := newD1D5MemorySecretStore()
	custody, err := accountservice.NewProtectedBinaryCustody(secrets)
	if err != nil {
		t.Fatal(err)
	}
	partition := "d1d5-offline-" + name
	if err := custody.Store(ctx, partition, accountservice.AccountMaterial{
		AccountID:          "acct-d1-d5",
		DisplayName:        "Offline User",
		CurrentUserHandle:  "offline_user",
		RealmEnvironmentID: "realm-prod-1",
		RealmOrigin:        realmBaseURL,
		AccessToken:        "expired-access-token",
		RefreshToken:       "valid-refresh-token",
		AccessTokenExpires: time.Now().UTC().Add(-2 * time.Hour),
	}); err != nil {
		t.Fatalf("seed expired offline account custody: %v", err)
	}

	desktopCaller := &runtimev1.AccountCaller{
		AppId:         "nimi.desktop",
		AppInstanceId: "desktop-1",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
	}
	registry := appregistry.New()
	if err := registry.UpsertInstance(desktopCaller.GetAppId(), desktopCaller.GetAppInstanceId(), desktopCaller.GetDeviceId(), []string{"account.session.read", "account.raw-token"}); err != nil {
		t.Fatal(err)
	}

	accountSvc := accountservice.NewProduction(nil, accountservice.ProductionConfig{
		PrimarySecrets:   secrets,
		PrimaryKeyScope:  "install-d1d5\x00os-user",
		RealmBaseURL:     realmBaseURL,
		RealmRealtimeURL: "wss://realm.d1d5.test/realtime",
		CustodyPartition: partition,
		Custody:          custody,
		HTTPClient:       realmHTTPClient,
		AppRegistry:      registry,
		AuditStore:       auditlog.New(64, 16),
	})

	boot := localAppSessionTestIdentifier(0x61)
	launchRegistry, err := protectedlocal.NewLocalAppLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	desktopClient := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 6101, CreationMarker: "desktop-start",
		OSLoginSession: "interactive-login", SecurityPrincipal: "S-1-5-21-100-200-300-1001",
		CanonicalExecutableIdentity: "desktop-exe", ExecutableDigest: localAppSessionTestIdentifier(0x62),
		ExecutableTrustSetID: "desktop-release",
	}
	runtimeServer := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 6102, CreationMarker: "runtime-start",
		OSLoginSession: "service-login", SecurityPrincipal: "runtime-service",
		CanonicalExecutableIdentity: "runtime-exe", ExecutableDigest: localAppSessionTestIdentifier(0x63),
		ExecutableTrustSetID: "runtime-release",
	}
	desktopConn, err := protectedlocal.EstablishDesktopConnection(ctx, builtInDesktopVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: desktopClient, Server: runtimeServer, ClientLiveness: &localAppSessionTestLiveness{revoked: make(chan struct{})},
		RuntimeBootEpoch: boot, EndpointInstanceID: localAppSessionTestIdentifier(0x64), TranscriptNonce: localAppSessionTestIdentifier(0x65),
	}}, bytes.NewReader(bytes.Repeat([]byte{0x66}, 64)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(desktopConn.Revoke)

	desktopCtx := protectedlocal.ContextWithDesktopConnection(ctx, desktopConn)
	desktopCtx = metadata.NewIncomingContext(desktopCtx, metadata.Pairs(
		"x-nimi-source-host", "protected-local-desktop-account-host",
		"x-nimi-caller-kind", "desktop-shell",
		"x-nimi-app-id", desktopCaller.GetAppId(),
		"x-nimi-app-instance-id", desktopCaller.GetAppInstanceId(),
		"x-nimi-device-id", desktopCaller.GetDeviceId(),
	))

	// Ensure any scheduled background refresh timer is stopped cleanly on test exit.
	t.Cleanup(func() {
		_, _ = accountSvc.Logout(desktopCtx, &runtimev1.LogoutRequest{Caller: desktopCaller})
	})

	// Reopen SQLite kernel + fresh registry client + fresh coordinator (no in-memory cache).
	kernel, err := localappkernel.OpenSQLite(ctx, dbPath, identity, localappkernel.Options{
		HostInstallID: "d1d5-offline-host",
		DataRoot:      dataRoot,
		Now:           now,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })

	registryClient := publicappregistry.NewCanonicalClient()
	coordinator, err := nimiappinstall.NewCoordinator(registryClient, kernel, slog.New(slog.NewTextHandler(io.Discard, nil)), auditlog.New(64, 16))
	if err != nil {
		t.Fatal(err)
	}
	coordinator.SetClock(now)
	carrier := protectedlocal.ManagedWebCarrier{
		ExecutablePath:   filepath.Join(dataRoot, "Product", "0.3.0", "NimiAppHost.exe"),
		ExecutableDigest: localAppSessionTestIdentifier(0x67),
	}
	coordinator.SetManagedWebCarrierResolver(protectedlocal.ManagedWebCarrierResolverFunc(func(context.Context) (protectedlocal.ManagedWebCarrier, error) {
		return carrier, nil
	}))
	t.Cleanup(func() { _ = coordinator.Close() })

	appSvc := New(nil,
		WithClock(now),
		WithLocalAppKernel(kernel),
		WithApprovedAppCatalogProvider(registryClient),
		WithAppInstallCoordinator(coordinator),
		WithRuntimeAccountProjectionProvider(accountSvc),
		WithLocalDevelopmentAuthority(nil, launchRegistry, nil, nil),
	)
	t.Cleanup(appSvc.Close)

	var livenessMu sync.Mutex
	var latestLiveness *localAppSessionTestLiveness
	appSvc.installedProcessVerifier = func(_ context.Context, pid uint32, policy protectedlocal.InstalledAppProcessPolicy) (protectedlocal.ProcessTuple, protectedlocal.DesktopProcessLiveness, error) {
		liveness := &localAppSessionTestLiveness{revoked: make(chan struct{})}
		livenessMu.Lock()
		latestLiveness = liveness
		livenessMu.Unlock()
		return protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: pid, CreationMarker: fmt.Sprintf("child-%d", pid),
			OSLoginSession: "interactive-login", SecurityPrincipal: "S-1-5-21-100-200-300-1001",
			CanonicalExecutablePath: policy.HostExecutablePath, CanonicalExecutableIdentity: policy.HostExecutablePath,
			ExecutableDigest: policy.HostExecutableDigest, ExecutableTrustSetID: "verified-package",
		}, liveness, nil
	}

	// Verify cold-start offline account state before returning fixture.
	statusResp, err := accountSvc.GetAccountSessionStatus(desktopCtx, &runtimev1.GetAccountSessionStatusRequest{Caller: desktopCaller})
	if err != nil || !statusResp.GetAccepted() {
		t.Fatalf("cold-start GetAccountSessionStatus = (%+v, %v)", statusResp, err)
	}
	snap := statusResp.GetSnapshot()
	if snap.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		snap.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED ||
		snap.GetAccountProjection().GetAccountId() != "acct-d1-d5" ||
		strings.TrimSpace(snap.GetAuthorizationRevision()) == "" {
		t.Fatalf("unexpected cold-start offline account snapshot = %+v", snap)
	}

	return &d1d5OfflineFixture{
		ctx:               ctx,
		desktopCtx:        desktopCtx,
		desktopCaller:     desktopCaller,
		handle:            handle,
		registryTransport: registryTransport,
		realmTransport:    realmTransport,
		accountSvc:        accountSvc,
		appSvc:            appSvc,
		childLiveness: func() *localAppSessionTestLiveness {
			livenessMu.Lock()
			defer livenessMu.Unlock()
			return latestLiveness
		},
	}
}

func assertD1D5OfflineLaunchSucceedsAndRealmFailsClosed(t *testing.T, f *d1d5OfflineFixture, childPID uint32) {
	t.Helper()
	// (b.1) Verified App Prepare + Bind succeeds offline using D1 indefinite
	// approval reuse and D5 retained local identity.
	prepared, err := f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
		LaunchSelector: []byte(f.handle),
	})
	if err != nil || len(prepared.GetLaunchId()) == 0 || prepared.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("offline PrepareInstalledAppLaunch failed: resp=%+v err=%v", prepared, err)
	}
	bound, err := f.appSvc.BindLocalAppProcess(f.desktopCtx, &runtimev1.BindLocalAppProcessRequest{
		LaunchId: prepared.GetLaunchId(), ChildProcessId: childPID,
	})
	if err != nil || bound.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("offline BindLocalAppProcess failed: resp=%+v err=%v", bound, err)
	}

	// (b.2) Online Realm calls still fail closed and never transmit the expired
	// Access Token to the Realm API.
	realmResp, err := f.accountSvc.InvokeRealmUnary(f.desktopCtx, &runtimev1.InvokeRealmUnaryRequest{
		Caller:      f.desktopCaller,
		MethodId:    "WorldPublicController_listWorldCatalog",
		RequestJson: `{}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary returned unexpected transport error: %v", err)
	}
	if realmResp.GetAccepted() ||
		realmResp.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
		realmResp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
		t.Fatalf("offline InvokeRealmUnary = %+v, want REALM_UNAVAILABLE + REFRESH_RETRY_DEFERRED", realmResp)
	}
	if _, err := f.accountSvc.BindRealmRealtimeAccount(f.ctx); err == nil {
		t.Fatal("BindRealmRealtimeAccount succeeded offline with expired access token")
	}
	if f.realmTransport.apiCalls.Load() != 0 {
		t.Fatalf("expired access token reached Realm API %d times", f.realmTransport.apiCalls.Load())
	}

	if liveness := f.childLiveness(); liveness != nil {
		_ = liveness.Close()
	}
	if _, err := f.appSvc.EndInstalledAppRun(f.desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatalf("EndInstalledAppRun: %v", err)
	}
}

func TestInstalledVerifiedAppOfflineAccountColdStartAndFailClosedTransitions(t *testing.T) {
	if _, _, _, err := publicappregistry.CurrentPlatformTarget(); err != nil {
		t.Skip("requires admitted desktop platform")
	}

	t.Run("explicit offline logout blocks in-flight bind and subsequent prepare", func(t *testing.T) {
		f := newD1D5OfflineColdStartFixture(t, "logout")
		assertD1D5OfflineLaunchSucceedsAndRealmFailsClosed(t, f, 7001)

		// Prepare while offline-authenticated, then explicitly Logout offline.
		prepared, err := f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
			LaunchSelector: []byte(f.handle),
		})
		if err != nil {
			t.Fatalf("prepare before logout failed: %v", err)
		}
		logoutResp, err := f.accountSvc.Logout(f.desktopCtx, &runtimev1.LogoutRequest{Caller: f.desktopCaller})
		if err != nil || !logoutResp.GetAccepted() || logoutResp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
			t.Fatalf("offline Logout = (%+v, %v)", logoutResp, err)
		}

		// In-flight Bind must fail closed.
		_, err = f.appSvc.BindLocalAppProcess(f.desktopCtx, &runtimev1.BindLocalAppProcessRequest{
			LaunchId: prepared.GetLaunchId(), ChildProcessId: 7002,
		})
		reason, _ := grpcerr.ExtractReasonCode(err)
		if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
			t.Fatalf("bind after explicit logout = code:%s reason:%s err:%v", status.Code(err), reason, err)
		}
		if _, err := f.appSvc.EndInstalledAppRun(f.desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
			t.Fatalf("EndInstalledAppRun: %v", err)
		}

		// Subsequent Prepare must fail closed.
		_, err = f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
			LaunchSelector: []byte(f.handle),
		})
		reason, _ = grpcerr.ExtractReasonCode(err)
		if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
			t.Fatalf("prepare after explicit logout = code:%s reason:%s err:%v", status.Code(err), reason, err)
		}
	})

	t.Run("explicit offline account switch blocks in-flight bind and subsequent prepare", func(t *testing.T) {
		f := newD1D5OfflineColdStartFixture(t, "switch")
		assertD1D5OfflineLaunchSucceedsAndRealmFailsClosed(t, f, 7011)

		prepared, err := f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
			LaunchSelector: []byte(f.handle),
		})
		if err != nil {
			t.Fatalf("prepare before account switch failed: %v", err)
		}
		switchResp, err := f.accountSvc.SwitchAccount(f.desktopCtx, &runtimev1.SwitchAccountRequest{Caller: f.desktopCaller})
		if err != nil || !switchResp.GetAccepted() || switchResp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
			t.Fatalf("offline SwitchAccount = (%+v, %v)", switchResp, err)
		}

		_, err = f.appSvc.BindLocalAppProcess(f.desktopCtx, &runtimev1.BindLocalAppProcessRequest{
			LaunchId: prepared.GetLaunchId(), ChildProcessId: 7012,
		})
		reason, _ := grpcerr.ExtractReasonCode(err)
		if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
			t.Fatalf("bind after explicit switch = code:%s reason:%s err:%v", status.Code(err), reason, err)
		}
		if _, err := f.appSvc.EndInstalledAppRun(f.desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
			t.Fatalf("EndInstalledAppRun: %v", err)
		}

		_, err = f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
			LaunchSelector: []byte(f.handle),
		})
		reason, _ = grpcerr.ExtractReasonCode(err)
		if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
			t.Fatalf("prepare after explicit switch = code:%s reason:%s err:%v", status.Code(err), reason, err)
		}
	})

	t.Run("confirmed Realm revocation on reconnect blocks in-flight bind and subsequent offline prepare", func(t *testing.T) {
		f := newD1D5OfflineColdStartFixture(t, "revoked")
		assertD1D5OfflineLaunchSucceedsAndRealmFailsClosed(t, f, 7021)

		prepared, err := f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
			LaunchSelector: []byte(f.handle),
		})
		if err != nil {
			t.Fatalf("prepare before confirmed revocation failed: %v", err)
		}

		// Reconnect to Realm and observe confirmed refresh token revocation.
		f.realmTransport.setRefreshFn(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusUnauthorized,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{"statusCode":401,"message":"Revoked","reasonCode":"AUTH_REFRESH_TOKEN_REVOKED","traceId":"trace-d1d5-revoked"}`)),
				Request:    req,
			}, nil
		})
		f.realmTransport.setOffline(false)

		realmResp, err := f.accountSvc.InvokeRealmUnary(f.desktopCtx, &runtimev1.InvokeRealmUnaryRequest{
			Caller:      f.desktopCaller,
			MethodId:    "WorldPublicController_listWorldCatalog",
			RequestJson: `{}`,
		})
		if err != nil || realmResp.GetAccepted() ||
			realmResp.GetReasonCode() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID ||
			realmResp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID {
			t.Fatalf("revoked InvokeRealmUnary = (%+v, %v)", realmResp, err)
		}

		// Go back offline: local identity MUST remain revoked and fail closed.
		f.realmTransport.setOffline(true)
		_, err = f.appSvc.BindLocalAppProcess(f.desktopCtx, &runtimev1.BindLocalAppProcessRequest{
			LaunchId: prepared.GetLaunchId(), ChildProcessId: 7022,
		})
		reason, _ := grpcerr.ExtractReasonCode(err)
		if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
			t.Fatalf("bind after confirmed revocation = code:%s reason:%s err:%v", status.Code(err), reason, err)
		}
		if _, err := f.appSvc.EndInstalledAppRun(f.desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
			t.Fatalf("EndInstalledAppRun: %v", err)
		}

		_, err = f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
			LaunchSelector: []byte(f.handle),
		})
		reason, _ = grpcerr.ExtractReasonCode(err)
		if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
			t.Fatalf("prepare after confirmed revocation = code:%s reason:%s err:%v", status.Code(err), reason, err)
		}
	})

	t.Run("observed Registry kill-switch blocks subsequent offline launch even with retained offline account", func(t *testing.T) {
		f := newD1D5OfflineColdStartFixture(t, "killswitch")
		assertD1D5OfflineLaunchSucceedsAndRealmFailsClosed(t, f, 7031)

		// Briefly reach Registry to observe kill-switch, then go offline again
		// while account remains offline-authenticated with expired Access Token.
		f.registryTransport.setBlocked(true)
		f.registryTransport.setOffline(false)
		if _, err := f.appSvc.ListApprovedAppCatalogTargets(f.ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); err != nil {
			t.Fatalf("catalog refresh observing kill-switch failed: %v", err)
		}
		f.registryTransport.setOffline(true)

		// Retained offline account identity is still live, but D1 kill-switch MUST block launch.
		_, err := f.appSvc.PrepareInstalledAppLaunch(f.desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
			LaunchSelector: []byte(f.handle),
		})
		reason, _ := grpcerr.ExtractReasonCode(err)
		if status.Code(err) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED {
			t.Fatalf("offline prepare after observed kill-switch = code:%s reason:%s err:%v", status.Code(err), reason, err)
		}
	})
}
