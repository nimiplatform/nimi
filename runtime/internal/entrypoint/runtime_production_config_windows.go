//go:build windows && !nimi_runtime_e2e

package entrypoint

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/oklog/ulid/v2"
)

const (
	windowsProductionRealmBaseURL     = "https://realm.nimi.ai"
	windowsDevKernelAccountRealmURL   = "http://localhost:3002"
	windowsDevKernelFixtureBaseURL    = "http://127.0.0.1:19443"
	windowsProductionRuntimeAudience  = "nimi-runtime"
	windowsProductionInstallStateFile = "installation.json"
	windowsAcceptanceProfileFile      = "non-release-acceptance-profile.json"
	windowsAcceptanceCheckpoint       = "dev_kernel_checkpoint"
	windowsRuntimeBuildRecordFile     = "runtime-build-record.json"
)

// Set only by the explicit non-release checkpoint build. A normal production
// Runtime fails closed if an acceptance profile is present beside its fixed
// service state.
var windowsNonReleaseAcceptanceProfileEnabled string

var windowsAcceptanceTrialIDPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)
var windowsRuntimeCandidateIDPattern = regexp.MustCompile(`^dev-kernel-runtime-[0-9a-f]{32}$`)
var windowsAcceptanceRoundIDPattern = regexp.MustCompile(`^dev-kernel-round-[0-9a-f]{32}$`)
var windowsRuntimeGitHeadPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type windowsProductionInstallState struct {
	SchemaVersion int    `json:"schemaVersion"`
	RuntimeID     string `json:"runtimeId"`
}

type windowsAcceptanceProfile struct {
	SchemaVersion               int    `json:"schemaVersion"`
	Checkpoint                  string `json:"checkpoint"`
	NonRelease                  bool   `json:"nonRelease"`
	TrialID                     string `json:"trialId"`
	RuntimeCandidateID          string `json:"runtimeCandidateId"`
	AcceptanceRoundID           string `json:"acceptanceRoundId"`
	DevelopmentDataRootRef      string `json:"developmentDataRootRef,omitempty"`
	AccountRealmBaseURL         string `json:"accountRealmBaseUrl"`
	FixtureBaseURL              string `json:"fixtureBaseUrl"`
	ProviderBaseURL             string `json:"providerBaseUrl"`
	PrimaryAccountID            string `json:"primaryAccountId"`
	SecondaryAccountID          string `json:"secondaryAccountId"`
	LocalAgentRef               string `json:"localAgentRef"`
	RuntimeSourceRef            string `json:"runtimeSourceRef"`
	AgentDisplayName            string `json:"agentDisplayName"`
	ExpiresAt                   string `json:"expiresAt"`
	SignerCertificateSHA256     string `json:"signerCertificateSha256"`
	RuntimeBinarySHA256         string `json:"runtimeBinarySha256"`
	RuntimeBuildRecordSHA256    string `json:"runtimeBuildRecordSha256"`
	SourceDirtyDescriptorSHA256 string `json:"sourceDirtyDescriptorSha256"`
	SourceTreeSHA256            string `json:"sourceTreeSha256"`
}

type windowsRuntimeBuildRecord struct {
	SchemaVersion int                         `json:"schemaVersion"`
	ArtifactKind  string                      `json:"artifactKind"`
	Checkpoint    string                      `json:"checkpoint"`
	NonRelease    bool                        `json:"nonRelease"`
	GeneratedAt   string                      `json:"generatedAt"`
	CandidateID   string                      `json:"candidateId"`
	Source        windowsRuntimeBuildSource   `json:"source"`
	Runtime       windowsRuntimeBuildArtifact `json:"runtime"`
}

type windowsRuntimeBuildSource struct {
	RepositoryID          string                         `json:"repositoryId"`
	HeadCommit            string                         `json:"headCommit"`
	Branch                string                         `json:"branch"`
	Dirty                 bool                           `json:"dirty"`
	TrackedDiffSHA256     string                         `json:"trackedDiffSha256"`
	UntrackedFiles        []windowsRuntimeBuildUntracked `json:"untrackedFiles"`
	SourceTreeSHA256      string                         `json:"sourceTreeSha256"`
	DirtyDescriptorSHA256 string                         `json:"dirtyDescriptorSha256"`
}

type windowsRuntimeBuildUntracked struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type windowsRuntimeBuildArtifact struct {
	BinarySHA256            string `json:"binarySha256"`
	SignerCertificateSHA256 string `json:"signerCertificateSha256"`
}

// loadWindowsProtectedRuntimeConfig constructs the production service config
// exclusively from the already-validated service-owned state root and fixed
// release policy. LocalSystem environment variables, argv, user-profile files,
// and caller-selected endpoints are intentionally not inputs.
func loadWindowsProtectedRuntimeConfig(stateRoot string) (config.Config, error) {
	root := filepath.Clean(strings.TrimSpace(stateRoot))
	if root == "." || !filepath.IsAbs(root) {
		return config.Config{}, fmt.Errorf("fixed Windows Runtime state root is required")
	}
	profile, err := loadWindowsAcceptanceProfile(root, time.Now().UTC())
	if err != nil {
		return config.Config{}, err
	}
	serviceDataRoot := root
	if profile != nil {
		serviceDataRoot = filepath.Join(root, "acceptance-runs", profile.TrialID, profile.RuntimeCandidateID, profile.AcceptanceRoundID)
	}
	runtimeRoot := filepath.Join(serviceDataRoot, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return config.Config{}, fmt.Errorf("create service-owned Runtime config root: %w", err)
	}
	runtimeID, err := loadOrCreateWindowsProductionRuntimeID(filepath.Join(runtimeRoot, windowsProductionInstallStateFile))
	if err != nil {
		return config.Config{}, err
	}

	cfg := config.Config{
		// Protected startup never opens these ordinary listeners, but Config
		// retains valid loopback values for shared service construction.
		GRPCAddr:        "127.0.0.1:46371",
		HTTPAddr:        "127.0.0.1:46372",
		ShutdownTimeout: 10 * time.Second,
		LocalStatePath:  filepath.Join(runtimeRoot, "local-state.json"),
		LocalModelsPath: "",
		RuntimeID:       runtimeID,
		DataRootRef:     "",
		ManagedRoots:    config.ManagedRootsConfig{},
		LocalService: config.LocalServiceConfig{
			Enabled: true,
			Mode:    config.LocalServiceModeDesktopLocal,
		},
		SessionTTLMinSeconds:                 60,
		SessionTTLMaxSeconds:                 86_400,
		AIHealthIntervalSeconds:              8,
		AIHTTPTimeoutSeconds:                 30,
		GlobalConcurrencyLimit:               8,
		PerAppConcurrencyLimit:               2,
		IdempotencyCapacity:                  10_000,
		MaxDelegationDepth:                   3,
		AuditRingBufferSize:                  20_000,
		UsageStatsBufferSize:                 50_000,
		LocalAuditCapacity:                   5_000,
		LogLevel:                             "info",
		AuthJWTIssuer:                        windowsProductionRealmBaseURL,
		AuthJWTAudience:                      windowsProductionRuntimeAudience,
		AuthJWTJWKSURL:                       windowsProductionRealmBaseURL + "/api/auth/jwks",
		AuthJWTRevocationURL:                 windowsProductionRealmBaseURL + "/api/auth/sessions/introspect",
		AccountRealmBaseURL:                  windowsProductionRealmBaseURL,
		Providers:                            map[string]config.RuntimeFileTarget{},
		SchedulingDiskDenialThresholdBytes:   500 * 1024 * 1024,
		SchedulingSlowdownRAMThresholdBytes:  2 * 1024 * 1024 * 1024,
		SchedulingSlowdownVRAMThresholdBytes: 1 * 1024 * 1024 * 1024,
		SchedulingSlowdownDiskThresholdBytes: 2 * 1024 * 1024 * 1024,
		SchedulingPreemptionOccupancyPercent: 75,
	}
	if profile != nil {
		cfg.AuthJWTIssuer = profile.AccountRealmBaseURL
		cfg.AuthJWTJWKSURL = profile.AccountRealmBaseURL + "/api/auth/jwks"
		cfg.AuthJWTRevocationURL = profile.AccountRealmBaseURL + "/api/auth/sessions/introspect"
		cfg.AccountRealmBaseURL = profile.AccountRealmBaseURL
		cfg.AccountAuthorizationURL = profile.AccountRealmBaseURL + "/api/auth/oauth/authorize"
		cfg.AccountTokenURL = profile.AccountRealmBaseURL + "/api/auth/oauth/token"
		cfg.DefaultLocalTextModel = "runtime-agent-live-e2e"
		cfg.AllowLoopbackProviderEndpoint = true
		cfg.ModelCatalogCustomDir = filepath.Join(runtimeRoot, "model-catalog-custom")
		cfg.NonReleaseDevKernelCheckpoint = &config.DevKernelCheckpointAcceptance{
			TrialID:                profile.TrialID,
			RuntimeCandidateID:     profile.RuntimeCandidateID,
			AcceptanceRoundID:      profile.AcceptanceRoundID,
			DevelopmentDataRootRef: profile.DevelopmentDataRootRef,
			PrimaryAccountID:       profile.PrimaryAccountID,
			SecondaryAccountID:     profile.SecondaryAccountID,
			LocalAgentRef:          profile.LocalAgentRef,
			RuntimeSourceRef:       profile.RuntimeSourceRef,
			AgentDisplayName:       profile.AgentDisplayName,
		}
	}
	serviceConfigPath := filepath.Join(runtimeRoot, config.ServiceOwnedConfigFilename)
	if err := config.ApplyServiceOwnedDataRoot(&cfg, serviceConfigPath); err != nil {
		return config.Config{}, fmt.Errorf("apply fixed Windows Runtime mutable config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return config.Config{}, fmt.Errorf("validate fixed Windows Runtime config: %w", err)
	}
	return cfg, nil
}

func loadWindowsAcceptanceProfile(root string, now time.Time) (*windowsAcceptanceProfile, error) {
	path := filepath.Join(root, "runtime", windowsAcceptanceProfileFile)
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open Windows Runtime acceptance profile: %w", err)
	}
	defer func() { _ = file.Close() }()
	if windowsNonReleaseAcceptanceProfileEnabled != "true" {
		return nil, fmt.Errorf("non-release Runtime acceptance profile is forbidden in this build")
	}
	var profile windowsAcceptanceProfile
	decoder := json.NewDecoder(io.LimitReader(file, 8192))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&profile); err != nil {
		return nil, fmt.Errorf("decode Windows Runtime acceptance profile: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("decode Windows Runtime acceptance profile: unexpected trailing content")
	}
	if profile.SchemaVersion != 4 || profile.Checkpoint != windowsAcceptanceCheckpoint || !profile.NonRelease {
		return nil, fmt.Errorf("Windows Runtime acceptance profile identity is invalid")
	}
	if !windowsAcceptanceTrialIDPattern.MatchString(profile.TrialID) {
		return nil, fmt.Errorf("Windows Runtime acceptance profile trialId is invalid")
	}
	if !windowsAcceptanceRoundIDPattern.MatchString(profile.AcceptanceRoundID) {
		return nil, fmt.Errorf("Windows Runtime acceptance profile acceptanceRoundId is invalid")
	}
	expiresAt, err := time.Parse(time.RFC3339, profile.ExpiresAt)
	if err != nil || !expiresAt.After(now) || expiresAt.After(now.Add(48*time.Hour)) {
		return nil, fmt.Errorf("Windows Runtime acceptance profile expiry is invalid")
	}
	signer := strings.ToLower(strings.TrimSpace(profile.SignerCertificateSHA256))
	if len(signer) != 64 || signer != strings.ToLower(strings.TrimSpace(protectedlocal.WindowsProductionSignerCertSHA256)) {
		return nil, fmt.Errorf("Windows Runtime acceptance profile signer is invalid")
	}
	runtimeHash := strings.ToLower(strings.TrimSpace(profile.RuntimeBinarySHA256))
	if len(runtimeHash) != 64 {
		return nil, fmt.Errorf("Windows Runtime acceptance profile binary hash is invalid")
	}
	actualRuntimeHash, err := windowsRuntimeExecutableSHA256()
	if err != nil {
		return nil, err
	}
	if actualRuntimeHash != runtimeHash {
		return nil, fmt.Errorf("Windows Runtime acceptance profile binary hash mismatch")
	}
	buildRecordHash := strings.ToLower(strings.TrimSpace(profile.RuntimeBuildRecordSHA256))
	if !isWindowsAcceptanceSHA256(buildRecordHash) {
		return nil, fmt.Errorf("Windows Runtime acceptance profile build record hash is invalid")
	}
	buildRecord, err := loadWindowsRuntimeBuildRecord(buildRecordHash)
	if err != nil {
		return nil, err
	}
	if buildRecord.Runtime.BinarySHA256 != runtimeHash {
		return nil, fmt.Errorf("Windows Runtime build record binary hash mismatch")
	}
	if !windowsRuntimeCandidateIDPattern.MatchString(profile.RuntimeCandidateID) || profile.RuntimeCandidateID != buildRecord.CandidateID {
		return nil, fmt.Errorf("Windows Runtime acceptance profile candidate identity mismatch")
	}
	if buildRecord.Runtime.SignerCertificateSHA256 != signer {
		return nil, fmt.Errorf("Windows Runtime build record signer mismatch")
	}
	if buildRecord.Source.DirtyDescriptorSHA256 != strings.ToLower(strings.TrimSpace(profile.SourceDirtyDescriptorSHA256)) {
		return nil, fmt.Errorf("Windows Runtime build record dirty source descriptor mismatch")
	}
	if buildRecord.Source.SourceTreeSHA256 != strings.ToLower(strings.TrimSpace(profile.SourceTreeSHA256)) {
		return nil, fmt.Errorf("Windows Runtime build record source tree mismatch")
	}
	if err := validateWindowsAcceptanceAccountRealmURL(profile.AccountRealmBaseURL); err != nil {
		return nil, fmt.Errorf("validate Windows Runtime acceptance account Realm URL: %w", err)
	}
	if err := validateWindowsAcceptanceProviderPair(profile.FixtureBaseURL, profile.ProviderBaseURL); err != nil {
		return nil, fmt.Errorf("validate Windows Runtime acceptance provider fixture: %w", err)
	}
	if profile.DevelopmentDataRootRef != "" {
		root := filepath.Clean(strings.TrimSpace(profile.DevelopmentDataRootRef))
		if root != profile.DevelopmentDataRootRef || !filepath.IsAbs(root) || root == filepath.VolumeName(root)+string(filepath.Separator) {
			return nil, fmt.Errorf("Windows Runtime acceptance development data root is invalid")
		}
		info, statErr := os.Lstat(root)
		if statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("Windows Runtime acceptance development data root is unavailable or unsafe")
		}
	}
	acceptance := &config.DevKernelCheckpointAcceptance{
		TrialID: profile.TrialID, RuntimeCandidateID: profile.RuntimeCandidateID,
		AcceptanceRoundID:      profile.AcceptanceRoundID,
		DevelopmentDataRootRef: profile.DevelopmentDataRootRef,
		PrimaryAccountID:       profile.PrimaryAccountID, SecondaryAccountID: profile.SecondaryAccountID,
		LocalAgentRef: profile.LocalAgentRef, RuntimeSourceRef: profile.RuntimeSourceRef,
		AgentDisplayName: profile.AgentDisplayName,
	}
	if err := config.ValidateDevKernelCheckpointAcceptance(acceptance); err != nil {
		return nil, fmt.Errorf("validate Windows Runtime acceptance identity: %w", err)
	}
	return &profile, nil
}

func windowsRuntimeExecutableSHA256() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve Windows Runtime executable for acceptance profile: %w", err)
	}
	binary, err := os.Open(executable)
	if err != nil {
		return "", fmt.Errorf("open Windows Runtime executable for acceptance profile: %w", err)
	}
	hash := sha256.New()
	_, hashErr := io.Copy(hash, binary)
	closeErr := binary.Close()
	if hashErr != nil || closeErr != nil {
		return "", fmt.Errorf("hash Windows Runtime executable for acceptance profile")
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func loadWindowsRuntimeBuildRecord(expectedHash string) (windowsRuntimeBuildRecord, error) {
	executable, err := os.Executable()
	if err != nil {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("resolve Windows Runtime executable for build record: %w", err)
	}
	path := filepath.Join(filepath.Dir(executable), "resources", windowsRuntimeBuildRecordFile)
	file, err := os.Open(path)
	if err != nil {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("open Windows Runtime build record: %w", err)
	}
	payload, err := io.ReadAll(io.LimitReader(file, 1024*1024))
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("read Windows Runtime build record")
	}
	actualHash := fmt.Sprintf("%x", sha256.Sum256(payload))
	if actualHash != expectedHash {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("Windows Runtime build record hash mismatch")
	}
	var record windowsRuntimeBuildRecord
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&record); err != nil {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("decode Windows Runtime build record: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("decode Windows Runtime build record: unexpected trailing content")
	}
	if record.SchemaVersion != 1 ||
		record.ArtifactKind != "nimi.windows-runtime-service-binary" ||
		record.Checkpoint != windowsAcceptanceCheckpoint ||
		!record.NonRelease ||
		!windowsRuntimeCandidateIDPattern.MatchString(record.CandidateID) ||
		record.Source.RepositoryID != "nimi" ||
		!windowsRuntimeGitHeadPattern.MatchString(record.Source.HeadCommit) ||
		!isWindowsAcceptanceSHA256(record.Source.TrackedDiffSHA256) ||
		!isWindowsAcceptanceSHA256(record.Source.DirtyDescriptorSHA256) ||
		!isWindowsAcceptanceSHA256(record.Source.SourceTreeSHA256) ||
		!isWindowsAcceptanceSHA256(record.Runtime.BinarySHA256) ||
		!isWindowsAcceptanceSHA256(record.Runtime.SignerCertificateSHA256) {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("Windows Runtime build record identity is invalid")
	}
	if _, err := time.Parse(time.RFC3339Nano, record.GeneratedAt); err != nil {
		return windowsRuntimeBuildRecord{}, fmt.Errorf("Windows Runtime build record timestamp is invalid")
	}
	for _, entry := range record.Source.UntrackedFiles {
		clean := filepath.Clean(strings.TrimSpace(entry.Path))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || !isWindowsAcceptanceSHA256(entry.SHA256) {
			return windowsRuntimeBuildRecord{}, fmt.Errorf("Windows Runtime build record untracked source entry is invalid")
		}
	}
	return record, nil
}

func isWindowsAcceptanceSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func validateWindowsAcceptanceAccountRealmURL(raw string) error {
	if strings.TrimSpace(raw) != windowsDevKernelAccountRealmURL {
		return fmt.Errorf("exact dev-kernel Realm URL is required")
	}
	return nil
}

func validateWindowsAcceptanceProviderPair(fixtureBaseURL, providerBaseURL string) error {
	if strings.TrimSpace(fixtureBaseURL) != windowsDevKernelFixtureBaseURL {
		return fmt.Errorf("exact dev-kernel fixture URL is required")
	}
	if err := validateWindowsAcceptanceLoopbackURL(fixtureBaseURL, false); err != nil {
		return fmt.Errorf("fixture base URL: %w", err)
	}
	if err := validateWindowsAcceptanceLoopbackURL(providerBaseURL, true); err != nil {
		return fmt.Errorf("provider URL: %w", err)
	}
	wantProvider := strings.TrimRight(strings.TrimSpace(fixtureBaseURL), "/") + "/v1"
	if strings.TrimSpace(providerBaseURL) != wantProvider {
		return fmt.Errorf("provider URL must use the exact fixture origin")
	}
	return nil
}

func validateWindowsAcceptanceLoopbackURL(raw string, provider bool) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.Port() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("exact loopback HTTP URL with explicit port is required")
	}
	host := strings.Trim(strings.ToLower(parsed.Hostname()), "[]")
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return fmt.Errorf("non-loopback host is forbidden")
	}
	wantPath := ""
	if provider {
		wantPath = "/v1"
	}
	if parsed.EscapedPath() != wantPath && !(wantPath == "" && parsed.EscapedPath() == "/") {
		return fmt.Errorf("unexpected URL path")
	}
	return nil
}

func loadOrCreateWindowsProductionRuntimeID(path string) (string, error) {
	state, err := readWindowsProductionInstallState(path)
	if err == nil {
		return state.RuntimeID, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	state = windowsProductionInstallState{
		SchemaVersion: 1,
		RuntimeID:     config.GenerateRuntimeID(),
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("marshal Windows Runtime installation state: %w", err)
	}
	raw = append(raw, '\n')
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		recovered, readErr := readWindowsProductionInstallState(path)
		if readErr != nil {
			return "", readErr
		}
		return recovered.RuntimeID, nil
	}
	if err != nil {
		return "", fmt.Errorf("create Windows Runtime installation state: %w", err)
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(raw); err != nil {
		return "", fmt.Errorf("write Windows Runtime installation state: %w", err)
	}
	if err := file.Sync(); err != nil {
		return "", fmt.Errorf("sync Windows Runtime installation state: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close Windows Runtime installation state: %w", err)
	}
	cleanup = false
	return state.RuntimeID, nil
}

func readWindowsProductionInstallState(path string) (windowsProductionInstallState, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return windowsProductionInstallState{}, os.ErrNotExist
		}
		return windowsProductionInstallState{}, fmt.Errorf("open Windows Runtime installation state: %w", err)
	}
	defer func() { _ = file.Close() }()
	var state windowsProductionInstallState
	decoder := json.NewDecoder(io.LimitReader(file, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return windowsProductionInstallState{}, fmt.Errorf("decode Windows Runtime installation state: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return windowsProductionInstallState{}, fmt.Errorf("decode Windows Runtime installation state: unexpected trailing content")
	}
	if state.SchemaVersion != 1 {
		return windowsProductionInstallState{}, fmt.Errorf("Windows Runtime installation state schemaVersion must be 1")
	}
	parsed, err := ulid.ParseStrict(strings.TrimSpace(state.RuntimeID))
	if err != nil || parsed.String() != state.RuntimeID {
		return windowsProductionInstallState{}, fmt.Errorf("Windows Runtime installation state runtimeId is invalid")
	}
	return state, nil
}

func prepareWindowsRuntimeFixture(_ context.Context, state *protectedlocal.WindowsRuntimeSecurityState, cfg config.Config) error {
	if windowsNonReleaseAcceptanceProfileEnabled != "true" || !cfg.AllowLoopbackProviderEndpoint {
		return nil
	}
	if state == nil {
		return fmt.Errorf("verified Windows Runtime security state is required")
	}
	return ensureWindowsAcceptanceRuntimeSeed(state.ServiceStatePath(), cfg)
}
