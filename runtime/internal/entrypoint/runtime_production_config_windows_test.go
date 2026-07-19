//go:build windows && !nimi_runtime_e2e

package entrypoint

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestWindowsProductionRuntimeConfigUsesOnlyServiceOwnedRootAndFixedAuthority(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:59999")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "https://attacker.invalid")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_ISSUER", "https://attacker.invalid")

	root := t.TempDir()
	first, err := loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("load production config: %v", err)
	}
	second, err := loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("reload production config: %v", err)
	}
	if first.RuntimeID == "" || second.RuntimeID != first.RuntimeID {
		t.Fatalf("service-owned RuntimeID is not stable: first=%q second=%q", first.RuntimeID, second.RuntimeID)
	}
	if first.GRPCAddr != "127.0.0.1:46371" || first.AccountRealmBaseURL != windowsProductionRealmBaseURL || first.AuthJWTIssuer != windowsProductionRealmBaseURL {
		t.Fatalf("caller environment altered production config: %+v", first)
	}
	wantState := filepath.Join(root, "runtime", windowsProductionInstallStateFile)
	if _, err := os.Stat(wantState); err != nil {
		t.Fatalf("service-owned installation state missing: %v", err)
	}
}

func TestValidateWindowsAcceptanceDataRootRejectsReparseAncestor(t *testing.T) {
	directRoot := filepath.Join(t.TempDir(), "direct", "nimi-data")
	if err := os.MkdirAll(directRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsAcceptanceDataRoot(directRoot); err != nil {
		t.Fatalf("direct development data root rejected: %v", err)
	}

	targetRoot := filepath.Join(t.TempDir(), "target")
	if err := os.MkdirAll(filepath.Join(targetRoot, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	linkRoot := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(targetRoot, linkRoot); err != nil {
		t.Skipf("Windows symlink privilege unavailable: %v", err)
	}
	if err := validateWindowsAcceptanceDataRoot(filepath.Join(linkRoot, "nested")); err == nil {
		t.Fatal("development data root with a reparse-point ancestor was accepted")
	}
}

func TestWindowsNonReleaseAcceptanceProfileIsExplicitBoundedAndServiceOwned(t *testing.T) {
	previousFlag := windowsNonReleaseAcceptanceProfileEnabled
	previousSigner := protectedlocal.WindowsProductionSignerCertSHA256
	windowsNonReleaseAcceptanceProfileEnabled = "true"
	protectedlocal.WindowsProductionSignerCertSHA256 = "96d9dc911ad1d9d1e5ca17b557b3b4089e9a949ff57fab016b5e3c4049c7c12a"
	t.Cleanup(func() {
		windowsNonReleaseAcceptanceProfileEnabled = previousFlag
		protectedlocal.WindowsProductionSignerCertSHA256 = previousSigner
	})
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	profile := windowsAcceptanceProfile{
		SchemaVersion:               5,
		Checkpoint:                  windowsAcceptanceCheckpoint,
		NonRelease:                  true,
		TrialID:                     "dev-kernel-checkpoint",
		RuntimeCandidateID:          "dev-kernel-runtime-0123456789abcdef0123456789abcdef",
		DevelopmentStateCandidateID: "dev-kernel-runtime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		AcceptanceRoundID:           "dev-kernel-round-0123456789abcdef0123456789abcdef",
		AccountRealmBaseURL:         windowsDevKernelAccountRealmURL,
		FixtureBaseURL:              "http://127.0.0.1:19443",
		ProviderBaseURL:             "http://127.0.0.1:19443/v1",
		PrimaryAccountID:            "01J00000000000000000000000",
		SecondaryAccountID:          "01J00000000000000000000001",
		LocalAgentRef:               "local-agent:runtime-1f2e3d4c5b6a79800123456789abcdef",
		RuntimeSourceRef:            "dev-kernel-source-primary",
		AgentDisplayName:            "知语开发内核验收伙伴",
		ExpiresAt:                   time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
		SignerCertificateSHA256:     protectedlocal.WindowsProductionSignerCertSHA256,
	}
	developmentDataRoot := t.TempDir()
	profile.DevelopmentDataRootRef = developmentDataRoot
	runtimeHash, err := windowsRuntimeExecutableSHA256()
	if err != nil {
		t.Fatal(err)
	}
	profile.RuntimeBinarySHA256 = runtimeHash
	buildRecord := windowsRuntimeBuildRecord{
		SchemaVersion: 1,
		ArtifactKind:  "nimi.windows-runtime-service-binary",
		Checkpoint:    windowsAcceptanceCheckpoint,
		NonRelease:    true,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		CandidateID:   "dev-kernel-runtime-0123456789abcdef0123456789abcdef",
		Source: windowsRuntimeBuildSource{
			RepositoryID:          "nimi",
			HeadCommit:            "0123456789abcdef0123456789abcdef01234567",
			Branch:                "refactory/third-party",
			Dirty:                 true,
			TrackedDiffSHA256:     "1111111111111111111111111111111111111111111111111111111111111111",
			UntrackedFiles:        []windowsRuntimeBuildUntracked{},
			SourceTreeSHA256:      "2222222222222222222222222222222222222222222222222222222222222222",
			DirtyDescriptorSHA256: "3333333333333333333333333333333333333333333333333333333333333333",
		},
		Runtime: windowsRuntimeBuildArtifact{
			BinarySHA256:            runtimeHash,
			SignerCertificateSHA256: protectedlocal.WindowsProductionSignerCertSHA256,
		},
	}
	buildRecordRaw, err := json.Marshal(buildRecord)
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	buildRecordDir := filepath.Join(filepath.Dir(executable), "resources")
	if err := os.MkdirAll(buildRecordDir, 0o700); err != nil {
		t.Fatal(err)
	}
	buildRecordPath := filepath.Join(buildRecordDir, windowsRuntimeBuildRecordFile)
	if err := os.WriteFile(buildRecordPath, buildRecordRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(buildRecordPath) })
	buildRecordHash := sha256.Sum256(buildRecordRaw)
	profile.RuntimeBuildRecordSHA256 = fmt.Sprintf("%x", buildRecordHash)
	profile.SourceDirtyDescriptorSHA256 = buildRecord.Source.DirtyDescriptorSHA256
	profile.SourceTreeSHA256 = buildRecord.Source.SourceTreeSHA256
	raw, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeRoot, windowsAcceptanceProfileFile), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("load non-release checkpoint config: %v", err)
	}
	wantRoot := filepath.Join(root, "acceptance-runs", profile.TrialID, profile.DevelopmentStateCandidateID, profile.AcceptanceRoundID, "runtime")
	if filepath.Dir(cfg.LocalStatePath) != wantRoot || cfg.DataRootRef != developmentDataRoot || cfg.LocalModelsPath != filepath.Join(developmentDataRoot, "models") || cfg.ManagedRoots.Dependencies != filepath.Join(developmentDataRoot, "dependencies") || cfg.AccountRealmBaseURL != windowsDevKernelAccountRealmURL || cfg.AuthJWTIssuer != windowsDevKernelAccountRealmURL || cfg.AccountAuthorizationURL != windowsDevKernelAccountRealmURL+"/api/auth/oauth/authorize" || cfg.AccountTokenURL != windowsDevKernelAccountRealmURL+"/api/auth/oauth/token" || !cfg.AllowLoopbackProviderEndpoint || cfg.NonReleaseDevKernelCheckpoint == nil || cfg.NonReleaseDevKernelCheckpoint.LocalAgentRef != profile.LocalAgentRef || cfg.NonReleaseDevKernelCheckpoint.AcceptanceRoundID != profile.AcceptanceRoundID || cfg.NonReleaseDevKernelCheckpoint.DevelopmentStateCandidateID != profile.DevelopmentStateCandidateID || cfg.NonReleaseDevKernelCheckpoint.DevelopmentDataRootRef != developmentDataRoot {
		t.Fatalf("checkpoint config did not retain its bounded service root: %+v", cfg)
	}
	serviceConfigPath := filepath.Join(wantRoot, config.ServiceOwnedConfigFilename)
	if changed, err := config.WriteServiceOwnedDataRoot(serviceConfigPath, developmentDataRoot); err != nil || !changed {
		t.Fatalf("write selected service-owned data root changed=%v err=%v", changed, err)
	}
	cfg, err = loadWindowsProtectedRuntimeConfig(root)
	if err != nil {
		t.Fatalf("reload selected non-release checkpoint config: %v", err)
	}
	if cfg.DataRootRef != developmentDataRoot || cfg.LocalModelsPath != filepath.Join(developmentDataRoot, "models") || cfg.ManagedRoots.Dependencies != filepath.Join(developmentDataRoot, "dependencies") || cfg.ManagedRoots.Environments != filepath.Join(developmentDataRoot, "environments") || cfg.ManagedRoots.Logs != filepath.Join(developmentDataRoot, "logs") || cfg.ManagedRoots.Audit != filepath.Join(developmentDataRoot, "audit") {
		t.Fatalf("checkpoint config did not consume selected service-owned data root: %+v", cfg)
	}
	profile.DevelopmentDataRootRef = filepath.Join(root, "missing-development-data")
	missingRootRaw, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeRoot, windowsAcceptanceProfileFile), missingRootRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadWindowsProtectedRuntimeConfig(root); err == nil {
		t.Fatal("acceptance profile admitted a missing development data root")
	}
	profile.DevelopmentDataRootRef = developmentDataRoot
	profile.RuntimeCandidateID = "dev-kernel-runtime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	mismatchedRaw, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeRoot, windowsAcceptanceProfileFile), mismatchedRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadWindowsProtectedRuntimeConfig(root); err == nil {
		t.Fatal("acceptance profile reused a partition under a candidate identity that did not match its signed build record")
	}
}

func TestWindowsAcceptanceProfileSeparatesRealAccountAndProviderFixtureAuthority(t *testing.T) {
	if err := validateWindowsAcceptanceAccountRealmURL(windowsDevKernelAccountRealmURL); err != nil {
		t.Fatalf("real dev Realm was rejected: %v", err)
	}
	for _, raw := range []string{"http://127.0.0.1:19443", windowsProductionRealmBaseURL, windowsDevKernelAccountRealmURL + "/"} {
		if err := validateWindowsAcceptanceAccountRealmURL(raw); err == nil {
			t.Fatalf("non-canonical account Realm was accepted: %q", raw)
		}
	}
	if err := validateWindowsAcceptanceProviderPair("http://127.0.0.1:19443", "http://127.0.0.1:19443/v1"); err != nil {
		t.Fatalf("bounded provider pair was rejected: %v", err)
	}
	for _, pair := range [][2]string{
		{windowsDevKernelAccountRealmURL, windowsDevKernelAccountRealmURL + "/v1"},
		{"http://127.0.0.1:19443", "http://127.0.0.1:19444/v1"},
		{"http://127.0.0.1:19443", "http://127.0.0.1:19443/api"},
	} {
		if err := validateWindowsAcceptanceProviderPair(pair[0], pair[1]); err == nil {
			t.Fatalf("invalid provider pair was accepted: %q %q", pair[0], pair[1])
		}
	}
}

func TestWindowsProductionBuildRejectsAcceptanceProfile(t *testing.T) {
	previousFlag := windowsNonReleaseAcceptanceProfileEnabled
	windowsNonReleaseAcceptanceProfileEnabled = ""
	t.Cleanup(func() { windowsNonReleaseAcceptanceProfileEnabled = previousFlag })
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeRoot, windowsAcceptanceProfileFile), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadWindowsProtectedRuntimeConfig(root); err == nil {
		t.Fatal("ordinary production build accepted a non-release checkpoint profile")
	}
}

func TestWindowsProductionRuntimeConfigFailsClosedOnCorruptInstallationState(t *testing.T) {
	root := t.TempDir()
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(runtimeRoot, windowsProductionInstallStateFile)
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"runtimeId":"not-a-ulid","extra":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadWindowsProtectedRuntimeConfig(root); err == nil {
		t.Fatal("corrupt service-owned installation state was accepted")
	}
}
