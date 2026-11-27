//go:build windows

package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
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
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"golang.org/x/sys/windows"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	_ "modernc.org/sqlite"
)

type serviceOfflineGraceTransport struct {
	mu              sync.Mutex
	revision        string
	revSeq          uint64
	documents       map[string][]byte
	assetURL        string
	asset           []byte
	offline         bool
	blocked         bool
	killSwitchRev   uint64
	beforeRoundTrip func(request *http.Request) (*http.Response, error, bool)
}

func (tr *serviceOfflineGraceTransport) setOffline(offline bool) {
	tr.mu.Lock()
	tr.offline = offline
	tr.mu.Unlock()
}

func (tr *serviceOfflineGraceTransport) setBlocked(blocked bool) {
	tr.mu.Lock()
	tr.blocked = blocked
	tr.killSwitchRev++
	tr.revSeq++
	tr.revision = fmt.Sprintf("%040x", 0x2000+tr.revSeq)
	tr.mu.Unlock()
}

func (tr *serviceOfflineGraceTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	tr.mu.Lock()
	hook := tr.beforeRoundTrip
	tr.mu.Unlock()
	if hook != nil {
		if resp, err, handled := hook(request); handled {
			return resp, err
		}
	}
	tr.mu.Lock()
	offline := tr.offline
	blocked := tr.blocked
	killSwitchRev := tr.killSwitchRev
	revision := tr.revision
	documents := tr.documents
	assetURL := tr.assetURL
	asset := tr.asset
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
			row := apps["publisher.grace-app"].(map[string]any)
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

func serviceGraceTestAppInfoJSON(t *testing.T, appID, version string) []byte {
	t.Helper()
	icon := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	icon.Set(64, 64, color.NRGBA{R: 35, G: 165, B: 220, A: 255})
	var iconBuf bytes.Buffer
	if err := png.Encode(&iconBuf, icon); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(nimiapppackage.AppInfo{
		Format: "nimi.app-info/v1", AppID: appID, Version: version, TargetID: "windows-x86_64",
		DisplayName: "Grace App", Summary: "Offline grace test App.",
		Icon:           nimiapppackage.AppInfoIcon{MediaType: "image/png", DataBase64: base64.StdEncoding.EncodeToString(iconBuf.Bytes())},
		ReadmeMarkdown: "Grace test.", ReleaseNotesMarkdown: "Release " + version,
		License:   nimiapppackage.AppInfoLicense{Identifier: "MIT", Text: "MIT\n"},
		AppAccess: []string{"runtime.consume"}, CapabilityContractRefs: []string{}, RequiredStandardizedFeatureRefs: []string{},
		StoragePolicy: nimiapppackage.AppInfoStoragePolicy{Kind: "nimi-mediated-default"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func buildServiceGraceTestPackage(t *testing.T, appID, version string) []byte {
	t.Helper()
	windowsDir, err := windows.GetSystemWindowsDirectory()
	if err != nil {
		t.Fatal(err)
	}
	compiler := filepath.Join(windowsDir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe")
	if _, err := os.Stat(compiler); err != nil {
		compiler = filepath.Join(windowsDir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
	}
	root := t.TempDir()
	exePath := filepath.Join(root, "grace-app.exe")
	srcPath := filepath.Join(root, "Program.cs")
	manifestPath := filepath.Join(root, "app.manifest")
	if err := os.WriteFile(srcPath, []byte("internal static class Program { [System.STAThread] private static void Main() {} }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, []byte(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
    <requestedExecutionLevel level="asInvoker" uiAccess="false" />
  </requestedPrivileges></security></trustInfo>
</assembly>
`), 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(compiler, "/nologo", "/target:winexe", "/platform:x64", "/out:"+exePath, "/win32manifest:"+manifestPath, srcPath).CombinedOutput(); err != nil {
		t.Fatalf("compile grace test PE: %v\n%s", err, output)
	}
	exeBytes, err := os.ReadFile(exePath)
	if err != nil {
		t.Fatal(err)
	}
	appInfoBytes := serviceGraceTestAppInfoJSON(t, appID, version)
	manifestBytes, _ := json.Marshal(map[string]any{
		"format": "nimi.app-package/v2", "app_id": appID, "version": version,
		"target_id": "windows-x86_64", "os": "windows", "arch": "x86_64", "runtime_entry": "payload/grace-app.exe",
		"native_trust":      map[string]any{"posture": "production-unsigned", "windows_authenticode": "unsigned", "certificate_subject": nil},
		"execution_profile": map[string]any{"requested_execution_level": "asInvoker", "ui_access": false},
	})
	type entry struct {
		name string
		data []byte
		mode uint32
	}
	entries := []entry{
		{"app-info.json", appInfoBytes, 0o644},
		{"LICENSE", []byte("MIT\n"), 0o644},
		{"manifest.json", manifestBytes, 0o644},
		{"nimi.app.yaml", []byte("app_id: " + appID + "\nversion: " + version + "\ndisplay_name: Grace App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\n"), 0o644},
		{"payload/grace-app.exe", exeBytes, 0o755},
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
			ExternalAttrs: (0o100000 | e.mode) << 16,
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

func buildServiceGraceRegistryDocs(t *testing.T, appID, version string, pkgBytes []byte, assetName, assetURL, repo string) map[string][]byte {
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

	infoRaw := serviceGraceTestAppInfoJSON(t, appID, version)
	infoSHA := sha256.Sum256(infoRaw)
	infoName := appID + "-" + version + "-windows-x86_64.app-info.json"

	descriptor := map[string]any{
		"schema_version":       1,
		"descriptor_id":        descriptorID,
		"publisher_submission": map[string]any{"pull_number": 7, "path": "submissions/publisher/" + appID + "/" + version + ".json", "head_sha": sourceCommit},
		"admission": map[string]any{
			"ordinary_release_proof": true, "trust_tier": "community", "build_assurance": "developer-attested",
			"dependency_assurance": map[string]any{"lockfile_reviewed": true, "sbom_ref": nil},
			"review":               map[string]any{"decision": "approved", "adjudicator_login": "maintainer", "adjudicator_actor_id": 42, "reason_code": "approved-review", "decided_at": "2026-09-04T00:00:00Z"},
		},
		"candidate": map[string]any{
			"app_id": appID, "display_name": "Grace App", "version": version,
			"publisher":  map[string]any{"github_namespace": "publisher", "namespace_kind": "organization", "assurance": "pseudonymous", "verified_domain_ref": nil, "kyc_ref": nil},
			"source":     map[string]any{"repository": repo, "license": map[string]any{"spdx_expression": "MIT", "files": []any{map[string]any{"path": "LICENSE", "sha256": strings.Repeat("1", 64)}}}},
			"release":    map[string]any{"tag": tag, "tag_protection_ref": "https://api.github.com/repos/publisher/grace-app/rulesets/1", "commit_sha": sourceCommit, "release_id": 21, "release_url": repo + "/releases/tag/" + tag, "release_notes_url": repo + "/releases/tag/" + tag, "immutable": true, "prerelease": false},
			"aggregate":  map[string]any{"asset_id": 100, "asset_name": "candidate.json", "asset_url": repo + "/releases/download/" + tag + "/candidate.json", "size": 10, "sha256": strings.Repeat("2", 64)},
			"package":    map[string]any{"kind": "nimiapp", "runtime_kind": "native", "registration_mode": "app-managed", "sandbox_ref": "windows-current-user-v1"},
			"app_access": []string{"runtime.consume"}, "capability_contract_refs": []string{}, "required_standardized_feature_refs": []string{},
			"storage_policy": map[string]any{"kind": "nimi-mediated-default", "os_storage_disclosure": nil},
			"update_channel": "stable", "rollback_marker": "none",
			"support": map[string]any{"diagnostics_bundle_fields": []string{}, "redaction_rules": []string{}, "issue_categories": []string{}, "escalation_url": repo + "/issues", "kill_switch_visibility": "visible", "recovery_instructions": "Reinstall."},
			"targets": []any{map[string]any{
				"target_id": "windows-x86_64", "os": "windows", "arch": "x86_64", "asset_id": 101,
				"app_info":   map[string]any{"asset_id": 102, "asset_name": infoName, "asset_url": repo + "/releases/download/" + tag + "/" + infoName, "size": len(infoRaw), "sha256": hex.EncodeToString(infoSHA[:])},
				"asset_name": assetName, "asset_url": assetURL, "size": len(pkgBytes), "sha256": pkgSHAHex,
				"runtime_entry": "payload/grace-app.exe", "provenance_attestation_refs": []string{"https://api.github.com/repos/publisher/grace-app/attestations/sha256:" + pkgSHAHex},
				"execution_profile_ref": "windows-user-mode-as-invoker-v1",
				"native_trust":          map[string]any{"signing_subject": nil, "observed_subject": nil, "entitlements_ref": nil, "windows_code_signing": "unsigned", "macos_notarization": "not-applicable", "macos_developer_id_subject": nil},
			}},
		},
	}
	index := map[string]any{
		"schema_version": 1,
		"apps": map[string]any{appID: map[string]any{
			"display_name": "Grace App", "visibility": "public", "admission_status": "approved",
			"kill_switch":                       map[string]any{"active": false, "reason": nil, "revision": 0},
			"latest_admitted_release_by_target": map[string]any{"windows-x86_64": map[string]any{"descriptor_id": descriptorID, "path": descriptorPath}},
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

func TestInstalledAppPrepareAndBindOfflineGraceAccountPermissionsAndKillSwitch(t *testing.T) {
	ctx := context.Background()
	appID := "publisher.grace-app"
	version := "1.0.0"
	repo := "https://github.com/publisher/grace-app"
	assetName := appID + "-" + version + "-windows-x86_64.nimiapp"
	assetURL := repo + "/releases/download/v" + version + "/" + assetName
	pkgBytes := buildServiceGraceTestPackage(t, appID, version)
	docs := buildServiceGraceRegistryDocs(t, appID, version, pkgBytes, assetName, assetURL, repo)

	transport := &serviceOfflineGraceTransport{
		revision:  strings.Repeat("a", 40),
		documents: docs,
		assetURL:  assetURL,
		asset:     pkgBytes,
	}
	prevTransport := http.DefaultTransport
	http.DefaultTransport = transport
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
	kernel, err := localappkernel.OpenSQLite(ctx, dbPath, identity, localappkernel.Options{
		HostInstallID: "service-grace-host",
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
	t.Cleanup(func() { _ = coordinator.Close() })

	snapshot, err := registryClient.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := snapshot.Resolve(ctx, appID, "windows-x86_64", "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	installed, err := coordinator.Install(ctx, resolved.Selector)
	if err != nil {
		t.Fatalf("install verified app: %v", err)
	}
	handle := installed.Registration.RegistrationHandle

	boot := localAppSessionTestIdentifier(0x41)
	launchRegistry, err := protectedlocal.NewLocalAppLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	desktopClient := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 5101, CreationMarker: "desktop-start",
		OSLoginSession: "interactive-login", SecurityPrincipal: "S-1-5-21-100-200-300-1001",
		CanonicalExecutableIdentity: "desktop-exe", ExecutableDigest: localAppSessionTestIdentifier(0x42),
		ExecutableTrustSetID: "desktop-release",
	}
	runtimeServer := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 5102, CreationMarker: "runtime-start",
		OSLoginSession: "service-login", SecurityPrincipal: "runtime-service",
		CanonicalExecutableIdentity: "runtime-exe", ExecutableDigest: localAppSessionTestIdentifier(0x43),
		ExecutableTrustSetID: "runtime-release",
	}
	desktopConn, err := protectedlocal.EstablishDesktopConnection(ctx, builtInDesktopVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: desktopClient, Server: runtimeServer, ClientLiveness: &localAppSessionTestLiveness{revoked: make(chan struct{})},
		RuntimeBootEpoch: boot, EndpointInstanceID: localAppSessionTestIdentifier(0x44), TranscriptNonce: localAppSessionTestIdentifier(0x45),
	}}, bytes.NewReader(bytes.Repeat([]byte{0x46}, 64)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(desktopConn.Revoke)
	desktopCtx := protectedlocal.ContextWithDesktopConnection(ctx, desktopConn)

	account := newLocalAppSessionTestAccount("account-1", "realm-1")
	service := New(nil,
		WithClock(now),
		WithLocalAppKernel(kernel),
		WithApprovedAppCatalogProvider(registryClient),
		WithAppInstallCoordinator(coordinator),
		WithRuntimeAccountProjectionProvider(account),
		WithLocalDevelopmentAuthority(nil, launchRegistry, nil, nil),
	)
	t.Cleanup(service.Close)
	var childLiveness *localAppSessionTestLiveness
	service.installedProcessVerifier = func(_ context.Context, pid uint32, policy protectedlocal.InstalledAppProcessPolicy) (protectedlocal.ProcessTuple, protectedlocal.DesktopProcessLiveness, error) {
		childLiveness = &localAppSessionTestLiveness{revoked: make(chan struct{})}
		return protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: pid, CreationMarker: fmt.Sprintf("child-%d", pid),
			OSLoginSession: "interactive-login", SecurityPrincipal: "S-1-5-21-100-200-300-1001",
			CanonicalExecutablePath: policy.HostExecutablePath, CanonicalExecutableIdentity: policy.HostExecutablePath,
			ExecutableDigest: policy.HostExecutableDigest, ExecutableTrustSetID: "verified-package",
		}, childLiveness, nil
	}

	// 1. Go offline at T0 + 24h (<7*24h): PrepareInstalledAppLaunch + BindLocalAppProcess succeed.
	transport.setOffline(true)
	advance(24 * time.Hour)
	prepared, err := service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{
		LaunchSelector: []byte(handle),
	})
	if err != nil || len(prepared.GetLaunchId()) == 0 {
		t.Fatalf("offline prepare within <7*24h failed: resp=%+v err=%v", prepared, err)
	}
	bound, err := service.BindLocalAppProcess(desktopCtx, &runtimev1.BindLocalAppProcessRequest{
		LaunchId: prepared.GetLaunchId(), ChildProcessId: 6001,
	})
	if err != nil || bound.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("offline bind within <7*24h failed: resp=%+v err=%v", bound, err)
	}
	_ = childLiveness.Close()
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatalf("end installed run: %v", err)
	}

	// 2. Signed-out / expired account immediately blocks PrepareInstalledAppLaunch even within <7*24h grace.
	account.signOut()
	_, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	reason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
		t.Fatalf("signed-out prepare error = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}

	// 3. Account sign-out between PrepareInstalledAppLaunch and BindLocalAppProcess blocks bind.
	account.replace("account-1", "realm-1")
	prepared, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil {
		t.Fatalf("prepare before sign-out failed: %v", err)
	}
	account.signOut()
	_, err = service.BindLocalAppProcess(desktopCtx, &runtimev1.BindLocalAppProcessRequest{LaunchId: prepared.GetLaunchId(), ChildProcessId: 6002})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
		t.Fatalf("bind after sign-out error = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}

	// 4. Account switch between Prepare and Bind blocks bind with LOCAL_APP_ACCOUNT_CHANGED.
	account.replace("account-1", "realm-1")
	prepared, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil {
		t.Fatalf("prepare before account switch failed: %v", err)
	}
	account.replace("account-2", "realm-2")
	_, err = service.BindLocalAppProcess(desktopCtx, &runtimev1.BindLocalAppProcessRequest{LaunchId: prepared.GetLaunchId(), ChildProcessId: 6003})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.Unauthenticated || reason != runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED {
		t.Fatalf("bind after account switch error = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}

	// 5. Permission/declaration change between Prepare and Bind immediately takes effect and rejects bind.
	prepared, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil {
		t.Fatalf("prepare before permission change failed: %v", err)
	}
	updatedReg, err := kernel.Registrations().RegisterInstalled(ctx, localappkernel.RegisterInstalledInput{
		ExistingRegistrationHandle: handle,
		AppID:                      installed.Registration.AppID,
		DisplayName:                installed.Registration.DisplayName,
		SourceRef:                  installed.Registration.SourceRef,
		ProjectRoot:                installed.Registration.ProjectRoot,
		ManifestPath:               installed.Registration.ManifestPath,
		RawDeclaration:             []string{"runtime.consume", "storage.local"},
		SourceClass:                localappkernel.SourceClassVerified,
		ImmutableLineageID:         installed.Registration.ImmutableLineageID,
		ProvenanceAttestationRefs:  installed.Registration.ProvenanceAttestationRefs,
		ProvenanceRevision:         installed.Registration.ProvenanceRevision,
		ExecutionProfileRef:        installed.Registration.ExecutionProfileRef,
		HostExecutableDigest:       installed.Registration.HostExecutableDigest,
		PayloadRootDigest:          installed.Registration.PayloadRootDigest,
	})
	if err != nil || updatedReg.DeclarationGeneration <= installed.Registration.DeclarationGeneration {
		t.Fatalf("update declaration generation: reg=%+v err=%v", updatedReg, err)
	}
	if _, err := service.BindLocalAppProcess(desktopCtx, &runtimev1.BindLocalAppProcessRequest{LaunchId: prepared.GetLaunchId(), ChildProcessId: 6004}); err == nil {
		t.Fatal("bind succeeded despite permission/declaration change between prepare and bind")
	}
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}
	// Restore original declaration to match launch config for remaining checks.
	if _, err := kernel.Registrations().RegisterInstalled(ctx, localappkernel.RegisterInstalledInput{
		ExistingRegistrationHandle: handle,
		AppID:                      installed.Registration.AppID,
		DisplayName:                installed.Registration.DisplayName,
		SourceRef:                  installed.Registration.SourceRef,
		ProjectRoot:                installed.Registration.ProjectRoot,
		ManifestPath:               installed.Registration.ManifestPath,
		RawDeclaration:             installed.Registration.RawDeclaration,
		SourceClass:                localappkernel.SourceClassVerified,
		ImmutableLineageID:         installed.Registration.ImmutableLineageID,
		ProvenanceAttestationRefs:  installed.Registration.ProvenanceAttestationRefs,
		ProvenanceRevision:         installed.Registration.ProvenanceRevision,
		ExecutionProfileRef:        installed.Registration.ExecutionProfileRef,
		HostExecutableDigest:       installed.Registration.HostExecutableDigest,
		PayloadRootDigest:          installed.Registration.PayloadRootDigest,
	}); err != nil {
		t.Fatal(err)
	}

	// 6. Exact 7 x 24h boundary offline blocks PrepareInstalledAppLaunch with APP_CATALOG_UNAVAILABLE.
	advance(nimiappinstall.VerifiedOfflineGraceWindow - 24*time.Hour)
	_, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.Unavailable || reason != runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE {
		t.Fatalf("exact 7*24h boundary error = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}

	// 7. Re-verifying online allows Prepare + Bind again.
	transport.setOffline(false)
	advance(time.Hour)
	prepared, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil {
		t.Fatalf("online prepare after expiry failed: %v", err)
	}
	if _, err := service.BindLocalAppProcess(desktopCtx, &runtimev1.BindLocalAppProcessRequest{LaunchId: prepared.GetLaunchId(), ChildProcessId: 6005}); err != nil {
		t.Fatalf("online bind after expiry failed: %v", err)
	}
	_ = childLiveness.Close()
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}

	// 8. Known kill-switch observed via live catalog fetch immediately blocks subsequent offline launch.
	transport.setBlocked(true)
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); err != nil {
		t.Fatalf("live catalog fetch with kill-switch failed: %v", err)
	}
	transport.setOffline(true)
	advance(time.Hour)
	_, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED {
		t.Fatalf("offline prepare after catalog-observed kill-switch = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}

	// 9. Lift kill-switch with incremented revision, then verify concurrent catalog kill-switch
	// beats an in-flight older PrepareInstalledAppLaunch allow AND deny persistence failures stay fail-closed
	// for both PrepareInstalledAppLaunch and BindLocalAppProcess.
	transport.setOffline(false)
	transport.setBlocked(false)
	advance(time.Hour)
	prepared, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil {
		t.Fatalf("prepare after lift failed: %v", err)
	}
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}

	// Capture current allowed revision for Request A, pause Request A while Request B (catalog fetch) observes kill-switch.
	transport.mu.Lock()
	oldRev := transport.revision
	oldKillSwitchRev := transport.killSwitchRev
	transport.mu.Unlock()
	enteredOldLaunch := make(chan struct{})
	releaseOldLaunch := make(chan struct{})
	var gateUsed atomic.Bool
	transport.mu.Lock()
	transport.beforeRoundTrip = func(request *http.Request) (*http.Response, error, bool) {
		if request.URL.String() == "https://github.com/nimiplatform/nimi-app-registry.git/info/refs?service=git-upload-pack" {
			if gateUsed.CompareAndSwap(false, true) {
				close(enteredOldLaunch)
				<-releaseOldLaunch
				ref := oldRev + " refs/heads/main\x00object-format=sha1\n"
				adv := fmt.Sprintf("001e# service=git-upload-pack\n0000%04x%s0000", len(ref)+4, ref)
				resp := &http.Response{
					StatusCode: http.StatusOK, Status: http.StatusText(http.StatusOK), Header: make(http.Header),
					Body: io.NopCloser(strings.NewReader(adv)), ContentLength: int64(len(adv)), Request: request,
				}
				resp.Header.Set("Content-Type", "application/x-git-upload-pack-advertisement")
				return resp, nil, true
			}
		}
		if request.URL.Host == "raw.githubusercontent.com" && strings.HasPrefix(request.URL.Path, "/nimiplatform/nimi-app-registry/"+oldRev+"/") {
			path := strings.TrimPrefix(request.URL.Path, "/nimiplatform/nimi-app-registry/"+oldRev+"/")
			if raw, ok := docs[path]; ok {
				if path == "index.json" {
					var index map[string]any
					_ = json.Unmarshal(raw, &index)
					apps := index["apps"].(map[string]any)
					row := apps[appID].(map[string]any)
					row["kill_switch"] = map[string]any{"active": false, "reason": nil, "revision": oldKillSwitchRev}
					raw, _ = json.Marshal(index)
				}
				return &http.Response{
					StatusCode: http.StatusOK, Status: http.StatusText(http.StatusOK), Header: make(http.Header),
					Body: io.NopCloser(bytes.NewReader(raw)), ContentLength: int64(len(raw)), Request: request,
				}, nil, true
			}
		}
		return nil, nil, false
	}
	transport.mu.Unlock()

	launchErrCh := make(chan error, 1)
	go func() {
		_, launchErr := service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
		launchErrCh <- launchErr
	}()
	<-enteredOldLaunch

	// Inject SQLite write+delete failure so catalog-observed kill-switch fails to persist on disk,
	// leaving the prior valid 7-day allow row physically in SQLite.
	rawDB, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rawDB.ExecContext(ctx, `CREATE TRIGGER test_fail_policy_update BEFORE UPDATE ON verified_app_policy_verification BEGIN SELECT RAISE(ABORT, 'disk full'); END`); err != nil {
		_ = rawDB.Close()
		t.Fatal(err)
	}
	if _, err := rawDB.ExecContext(ctx, `CREATE TRIGGER test_fail_policy_delete BEFORE DELETE ON verified_app_policy_verification BEGIN SELECT RAISE(ABORT, 'disk full'); END`); err != nil {
		_ = rawDB.Close()
		t.Fatal(err)
	}

	transport.setBlocked(true)
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); err != nil {
		_ = rawDB.Close()
		t.Fatalf("catalog refresh with kill-switch failed: %v", err)
	}
	close(releaseOldLaunch)
	errA := <-launchErrCh
	reason, _ = grpcerr.ExtractReasonCode(errA)
	if status.Code(errA) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED {
		_ = rawDB.Close()
		t.Fatalf("late in-flight PrepareInstalledAppLaunch after catalog kill-switch = code:%s reason:%s err:%v", status.Code(errA), reason, errA)
	}

	// Going offline while SQLite STILL holds the stale allow MUST still block PrepareInstalledAppLaunch.
	transport.mu.Lock()
	transport.beforeRoundTrip = nil
	transport.mu.Unlock()
	transport.setOffline(true)
	advance(time.Minute)
	_, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED {
		_ = rawDB.Close()
		t.Fatalf("offline prepare after failed catalog deny persistence = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}

	// Drop triggers so SQLite recovers, then verify lift -> prepare -> catalog deny (with DB write failure) -> offline bind blocked!
	if _, err := rawDB.ExecContext(ctx, `DROP TRIGGER test_fail_policy_update; DROP TRIGGER test_fail_policy_delete;`); err != nil {
		_ = rawDB.Close()
		t.Fatal(err)
	}
	transport.setOffline(false)
	transport.setBlocked(false)
	advance(time.Minute)
	prepared, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil {
		_ = rawDB.Close()
		t.Fatalf("prepare before bind deny test failed: %v", err)
	}
	if _, err := rawDB.ExecContext(ctx, `CREATE TRIGGER test_fail_policy_update BEFORE UPDATE ON verified_app_policy_verification BEGIN SELECT RAISE(ABORT, 'disk full'); END; CREATE TRIGGER test_fail_policy_delete BEFORE DELETE ON verified_app_policy_verification BEGIN SELECT RAISE(ABORT, 'disk full'); END;`); err != nil {
		_ = rawDB.Close()
		t.Fatal(err)
	}
	transport.setBlocked(true)
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); err != nil {
		_ = rawDB.Close()
		t.Fatalf("catalog refresh before bind failed: %v", err)
	}
	transport.setOffline(true)
	_, err = service.BindLocalAppProcess(desktopCtx, &runtimev1.BindLocalAppProcessRequest{
		LaunchId: prepared.GetLaunchId(), ChildProcessId: 6006,
	})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED {
		_ = rawDB.Close()
		t.Fatalf("offline bind after failed deny persistence = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}
	_, _ = rawDB.ExecContext(ctx, `DROP TRIGGER test_fail_policy_update; DROP TRIGGER test_fail_policy_delete;`)
	_ = rawDB.Close()
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}

	// 10. Stalled Registry under a short caller deadline MUST fall back to 7-day offline grace
	// before exhausting the parent deadline, while explicit parent cancellation still fails closed.
	transport.setOffline(false)
	transport.setBlocked(false)
	advance(time.Minute)
	prepared, err = service.PrepareInstalledAppLaunch(desktopCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil {
		t.Fatalf("re-verify online before stalled-deadline test failed: %v", err)
	}
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}

	var stallEntered chan struct{}
	var stallEnteredMu sync.Mutex
	transport.mu.Lock()
	transport.beforeRoundTrip = func(request *http.Request) (*http.Response, error, bool) {
		stallEnteredMu.Lock()
		ch := stallEntered
		stallEnteredMu.Unlock()
		if ch != nil {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
		<-request.Context().Done()
		return nil, request.Context().Err(), true
	}
	transport.mu.Unlock()
	defer func() {
		transport.mu.Lock()
		transport.beforeRoundTrip = nil
		transport.mu.Unlock()
	}()

	advance(time.Hour)
	deadlineCtx, deadlineCancel := context.WithTimeout(desktopCtx, 500*time.Millisecond)
	defer deadlineCancel()
	prepared, err = service.PrepareInstalledAppLaunch(deadlineCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
	if err != nil || len(prepared.GetLaunchId()) == 0 {
		t.Fatalf("stalled-Registry PrepareInstalledAppLaunch under deadline failed: resp=%+v err=%v", prepared, err)
	}
	bindDeadlineCtx, bindDeadlineCancel := context.WithTimeout(desktopCtx, 500*time.Millisecond)
	defer bindDeadlineCancel()
	bound, err = service.BindLocalAppProcess(bindDeadlineCtx, &runtimev1.BindLocalAppProcessRequest{
		LaunchId: prepared.GetLaunchId(), ChildProcessId: 6007,
	})
	if err != nil || bound.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("stalled-Registry BindLocalAppProcess under deadline failed: resp=%+v err=%v", bound, err)
	}
	_ = childLiveness.Close()
	if _, err := service.EndInstalledAppRun(desktopCtx, &runtimev1.EndInstalledAppRunRequest{LaunchId: prepared.GetLaunchId()}); err != nil {
		t.Fatal(err)
	}

	// Explicit parent cancellation during stalled Registry probe MUST fail closed with Canceled.
	enteredCh := make(chan struct{}, 1)
	stallEnteredMu.Lock()
	stallEntered = enteredCh
	stallEnteredMu.Unlock()
	cancelCtx, cancelParent := context.WithTimeout(desktopCtx, 2*time.Second)
	defer cancelParent()
	cancelErrCh := make(chan error, 1)
	go func() {
		_, callErr := service.PrepareInstalledAppLaunch(cancelCtx, &runtimev1.PrepareInstalledAppLaunchRequest{LaunchSelector: []byte(handle)})
		cancelErrCh <- callErr
	}()
	select {
	case <-enteredCh:
	case <-time.After(time.Second):
		t.Fatal("stalled Registry probe did not start for cancellation check")
	}
	cancelParent()
	if cancelErr := <-cancelErrCh; status.Code(cancelErr) != codes.Canceled {
		t.Fatalf("explicit parent cancellation under stalled Registry = %v, want Canceled", cancelErr)
	}
}
