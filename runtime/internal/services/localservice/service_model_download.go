package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	defaultHFDownloadBaseURL          = "https://huggingface.co"
	localModelDownloadTimeout         = 30 * time.Minute
	localModelDownloadMaxBodyBytes    = 64 << 30
	localArtifactDownloadTimeout      = 30 * time.Minute
	localArtifactDownloadMaxBodyBytes = 64 << 30
	// localModelDownloadMaxAttempts bounds the automatic retry-with-backoff loop
	// for a single managed model file. Multi-GB first-run downloads should feel
	// like a launcher download manager: transient network drops keep resuming in
	// the background for a long window before the job finally fails closed.
	localModelDownloadMaxAttempts = 64
	// localModelDownloadRetryBackoff is the base backoff between transient
	// retries; the loop applies an exponential-ish multiple per attempt.
	localModelDownloadRetryBackoff = 2 * time.Second
)

// errModelDownloadHashMismatch is the non-transient failure for a verified
// sha256 mismatch on the assembled file: the retry loop must never retry it and
// the caller must discard the `.download` partial.
var errModelDownloadHashMismatch = errors.New("model file hash mismatch")

type managedDownloadedModelSpec struct {
	modelID            string
	logicalModelID     string
	kind               runtimev1.LocalAssetKind
	capabilities       []string
	engine             string
	entry              string
	files              []string
	license            string
	repo               string
	revision           string
	hashes             map[string]string
	engineConfig       *structpb.Struct
	projectionOverride *modelregistry.NativeProjection
	existingPolicy     localAssetExistingPolicy
}

func (s *Service) installManagedDownloadedModel(
	ctx context.Context,
	spec managedDownloadedModelSpec,
) (*runtimev1.LocalAssetRecord, error) {
	modelID := strings.TrimSpace(spec.modelID)
	if modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	if strings.TrimSpace(spec.repo) == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: "downloaded model requires repo",
		})
	}
	files := normalizeStringSlice(spec.files)
	capabilities := normalizeAssetCapabilities(spec.capabilities)
	kind := spec.kind
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		kind = inferAssetKindFromCapabilities(capabilities)
	}
	if len(files) == 0 {
		files = []string{strings.TrimSpace(spec.entry)}
	}
	if len(files) == 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: "downloaded model requires at least one file",
		})
	}
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, err
	}
	logicalModelID := strings.TrimSpace(spec.logicalModelID)
	if logicalModelID == "" {
		logicalModelID = filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID(modelID)))
	}
	modelDir := runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	stagingDir, err := prepareManagedModelBundleStageDir(modelDir, "staging")
	if err != nil {
		return nil, err
	}

	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(stagingDir)
		}
	}()

	actualHashes := make(map[string]string, len(files))
	transfer := s.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID:   modelID,
		Phase:     "download",
		State:     localTransferStateRunning,
		Message:   "downloading managed model bundle",
		Retryable: true,
	})
	transferID := transfer.GetInstallSessionId()
	for _, file := range files {
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			s.failTransfer(transferID, err.Error(), false)
			return nil, err
		}
		targetPath := filepath.Join(stagingDir, filepath.FromSlash(relativeFile))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			s.failTransfer(transferID, fmt.Sprintf("create model file dir %q: %v", relativeFile, err), false)
			return nil, fmt.Errorf("create model file dir %q: %w", relativeFile, err)
		}
		fileHash, err := s.downloadManagedModelFile(ctx, transferID, spec.repo, spec.revision, relativeFile, targetPath, spec.hashes)
		if err != nil {
			if errors.Is(err, errLocalTransferCancelled) {
				s.cancelTransfer(transferID, "transfer cancelled")
			} else {
				s.failTransfer(transferID, err.Error(), true)
			}
			return nil, err
		}
		actualHashes[relativeFile] = "sha256:" + fileHash
	}
	entryFile := strings.TrimSpace(spec.entry)
	if entryFile == "" && len(files) > 0 {
		entryFile = files[0]
	}
	entryPath := filepath.Join(stagingDir, filepath.FromSlash(entryFile))
	if err := validateManagedModelEntryFile(entryPath); err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "downloaded model entry is invalid"},
		)
	}
	if err := validateManagedModelEntryStaticCompatibility(entryPath, kind, capabilities, spec.engine); err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "downloaded model entry is incompatible with its declaration"},
		)
	}
	engineConfig, projectionOverride, err := augmentManagedGGUFBundleFacts(
		modelsRoot,
		modelDir,
		stagingDir,
		entryPath,
		spec.engine,
		capabilities,
		files,
		spec.engineConfig,
		spec.projectionOverride,
	)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "downloaded model bundle metadata is invalid"},
		)
	}

	s.updateTransferProgress(transferID, "manifest", 0, 0, "writing model manifest")
	if err := writeModelManifest(manifestPathForStaging(stagingDir), managedModelManifestDescriptor{
		assetID:            modelID,
		kind:               kind,
		logicalModelID:     logicalModelID,
		capabilities:       capabilities,
		engine:             spec.engine,
		entry:              spec.entry,
		files:              files,
		license:            spec.license,
		repo:               spec.repo,
		revision:           spec.revision,
		hashes:             actualHashes,
		engineConfig:       engineConfig,
		projectionOverride: projectionOverride,
		integrityMode:      "verified",
	}); err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}

	activation, err := activateManagedModelBundle(modelDir, stagingDir)
	if err != nil {
		quarantinePath, quarantineErr := s.quarantineManagedModelBundle(
			modelsRoot,
			logicalModelID,
			stagingDir,
			"managed_model_download_install",
			fmt.Sprintf("activate bundle: %v", err),
			modelID,
			"",
		)
		if quarantineErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v; quarantine=%v", err, quarantineErr), false)
			return nil, fmt.Errorf("activate managed model bundle: %v; quarantine=%w", err, quarantineErr)
		}
		if strings.TrimSpace(quarantinePath) != "" {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v; quarantine=%s", err, quarantinePath), false)
		} else {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v", err), false)
		}
		return nil, fmt.Errorf("activate managed model bundle: %w", err)
	}
	success = true

	s.updateTransferProgress(transferID, "register", 0, 0, "registering model")
	record, err := s.installLocalAssetRecord(
		modelID,
		kind,
		capabilities,
		spec.engine,
		spec.entry,
		spec.license,
		spec.repo,
		spec.revision,
		actualHashes,
		"",
		engineConfig,
		projectionOverride,
		"runtime_model_ready_after_install",
		"model installed",
		spec.existingPolicy,
	)
	if err != nil {
		if quarantinePath, rollbackErr := activation.Rollback(
			s,
			modelsRoot,
			logicalModelID,
			"managed_model_download_install",
			err.Error(),
			modelID,
			"",
		); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("%s; rollback=%v", err.Error(), rollbackErr), false)
			return nil, err
		} else if strings.TrimSpace(quarantinePath) != "" {
			s.failTransfer(transferID, fmt.Sprintf("%s; quarantine=%s", err.Error(), quarantinePath), false)
			return nil, err
		}
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	if commitErr := activation.Commit(); commitErr != nil {
		s.logger.Warn("cleanup managed bundle backup failed after download install", "logical_model_id", logicalModelID, "error", commitErr)
	}
	s.completeTransfer(transferID, "register", "model installed", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.LocalAssetId = record.GetLocalAssetId()
		summary.AssetId = record.GetAssetId()
	})
	return record, nil
}

// resolveManagedBundleModelsRoot resolves the absolute models root a managed
// bundle install must stage and activate under. This is the single
// config-sourced runtime models root — `resolveLocalModelsPath(s.localModelsPath)`
// → `<dataRootRef>/models` (config.resolveLocalModelsPath / NewDataPlaneModel) —
// the same root every other models-root consumer reads (verify, engine
// activation, warm, residency, media).
//
// An empty or relative resolved root fails closed with a typed reason code: the
// runtime must never stage a multi-GB bundle into a relative `resolved/`
// directory resolved against its process CWD (the repo working tree on a
// desktop-bridge runtime). A relative model root is a fail-close condition, not
// a default — the desktop config sync must supply the user-selected data root
// before materialization.
func (s *Service) resolveManagedBundleModelsRoot() (string, error) {
	modelsRoot := strings.TrimSpace(s.resolvedLocalModelsPath())
	if modelsRoot == "" || !filepath.IsAbs(modelsRoot) {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "managed model install requires an absolute models root; runtime has no resolved data root",
			ActionHint: "select_nimi_data_root",
		})
	}
	return modelsRoot, nil
}

func manifestPathForStaging(stagingDir string) string {
	return filepath.Join(stagingDir, "asset.manifest.json")
}

func (s *Service) downloadManagedModelFile(
	ctx context.Context,
	sessionID string,
	repo string,
	revision string,
	relativeFile string,
	targetPath string,
	hashes map[string]string,
) (string, error) {
	requestURL, err := buildHFResolveURL(
		defaultString(strings.TrimSpace(s.hfDownloadBaseURL), defaultHFDownloadBaseURL),
		repo,
		defaultString(revision, "main"),
		relativeFile,
	)
	if err != nil {
		return "", err
	}
	expectedHash := expectedModelSHA256(hashes, relativeFile)
	if expectedHash == "" {
		return "", fmt.Errorf("model file %q requires admitted expected sha256 before download", relativeFile)
	}
	timeout := s.modelDownloadTimeout
	if timeout <= 0 {
		timeout = localModelDownloadTimeout
	}
	maxBodyBytes := s.modelDownloadMaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = localModelDownloadMaxBodyBytes
	}

	_ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = "download"
		summary.Message = "downloading " + relativeFile
		summary.State = localTransferStateRunning
	})

	header := http.Header{}
	header.Set("User-Agent", "nimi-runtime/0.1")

	result, err := s.downloadToFileWithTransfer(
		ctx,
		sessionID,
		"download",
		requestURL,
		targetPath,
		expectedHash,
		maxBodyBytes,
		header,
		timeout,
	)
	if err != nil {
		if errors.Is(err, errLocalTransferCancelled) {
			return "", err
		}
		if errors.Is(err, filedownload.ErrHashMismatch) {
			return "", fmt.Errorf("model file %q: %w: %v", relativeFile, errModelDownloadHashMismatch, err)
		}
		return "", fmt.Errorf("download model file %q: %w", relativeFile, err)
	}
	return result.SHA256, nil
}

// isTransientModelDownloadError classifies a model-download transport/stream
// error as worth a shared-core retry. Mid-stream connection drops
// (`unexpected EOF`), connection resets, broken pipes, and network timeouts
// are transient; the core handles 5xx, hash mismatch, 4xx, oversize and
// context cancellation itself and never routes them here.
func isTransientModelDownloadError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(lower, "eof") ||
		strings.Contains(lower, "connection reset") ||
		strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "connection refused") ||
		strings.Contains(lower, "tls handshake timeout") ||
		strings.Contains(lower, "timeout")
}

func normalizeArtifactRelativeFile(file string) (string, error) {
	cleaned := filepath.ToSlash(strings.TrimSpace(file))
	if cleaned == "" || cleaned == "." || cleaned == "/" {
		return "", fmt.Errorf("empty artifact relative file path")
	}
	cleaned = strings.TrimPrefix(cleaned, "./")
	cleaned = strings.TrimPrefix(cleaned, "/")
	if strings.Contains(cleaned, "..") {
		return "", fmt.Errorf("artifact relative file path must not contain '..': %s", cleaned)
	}
	return cleaned, nil
}

func buildHFResolveURL(baseURL string, repo string, revision string, relativeFile string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return "", fmt.Errorf("HF base URL required")
	}
	normalizedRepo := strings.TrimSpace(repo)
	if normalizedRepo == "" {
		return "", fmt.Errorf("HF repo required")
	}
	normalizedRevision := strings.TrimSpace(revision)
	if normalizedRevision == "" {
		normalizedRevision = "main"
	}
	normalizedFile := strings.TrimSpace(relativeFile)
	if normalizedFile == "" {
		return "", fmt.Errorf("HF relative file required")
	}
	return fmt.Sprintf("%s/%s/resolve/%s/%s", base, normalizedRepo, normalizedRevision, normalizedFile), nil
}

func expectedModelSHA256(hashes map[string]string, relativeFile string) string {
	if len(hashes) == 0 {
		return ""
	}
	value := strings.TrimSpace(hashes[relativeFile])
	if value == "" {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(strings.ToLower(value), "sha256:"))
}

type managedModelManifestDescriptor struct {
	assetID            string
	kind               runtimev1.LocalAssetKind
	logicalModelID     string
	capabilities       []string
	engine             string
	entry              string
	files              []string
	license            string
	repo               string
	revision           string
	hashes             map[string]string
	engineConfig       *structpb.Struct
	projectionOverride *modelregistry.NativeProjection
	integrityMode      string
}

func writeModelManifest(manifestPath string, descriptor managedModelManifestDescriptor) error {
	kindToken, err := localAssetKindToken(descriptor.kind)
	if err != nil {
		return err
	}
	manifest := map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         descriptor.assetID,
		"kind":             kindToken,
		"logical_model_id": descriptor.logicalModelID,
		"capabilities":     append([]string(nil), descriptor.capabilities...),
		"engine":           descriptor.engine,
		"entry":            descriptor.entry,
		"files":            append([]string(nil), descriptor.files...),
		"license":          descriptor.license,
		"source": map[string]any{
			"repo":     descriptor.repo,
			"revision": defaultString(descriptor.revision, "main"),
		},
		"hashes":         descriptor.hashes,
		"integrity_mode": descriptor.integrityMode,
	}
	if descriptor.engineConfig != nil {
		rawConfig, err := protojson.Marshal(descriptor.engineConfig)
		if err != nil {
			return fmt.Errorf("marshal model engine config: %w", err)
		}
		var decoded map[string]any
		if err := json.Unmarshal(rawConfig, &decoded); err != nil {
			return fmt.Errorf("decode model engine config: %w", err)
		}
		manifest["engine_config"] = decoded
	}
	if descriptor.projectionOverride != nil {
		if value := strings.TrimSpace(descriptor.projectionOverride.Family); value != "" {
			manifest["family"] = value
		}
		if len(descriptor.projectionOverride.ArtifactRoles) > 0 {
			manifest["artifact_roles"] = append([]string(nil), descriptor.projectionOverride.ArtifactRoles...)
		}
		if value := strings.TrimSpace(descriptor.projectionOverride.PreferredEngine); value != "" {
			manifest["preferred_engine"] = value
		}
		if len(descriptor.projectionOverride.FallbackEngines) > 0 {
			manifest["fallback_engines"] = append([]string(nil), descriptor.projectionOverride.FallbackEngines...)
		}
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal model manifest: %w", err)
	}
	if err := os.WriteFile(manifestPath, raw, 0o644); err != nil {
		return fmt.Errorf("write model manifest: %w", err)
	}
	return nil
}

func localAssetKindToken(kind runtimev1.LocalAssetKind) (string, error) {
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT:
		return "chat", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING:
		return "embedding", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE:
		return "image", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO:
		return "video", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS:
		return "tts", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT:
		return "stt", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE:
		return "vae", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CLIP:
		return "clip", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA:
		return "lora", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CONTROLNET:
		return "controlnet", nil
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY:
		return "auxiliary", nil
	default:
		return "", fmt.Errorf("local asset manifest requires concrete kind")
	}
}
