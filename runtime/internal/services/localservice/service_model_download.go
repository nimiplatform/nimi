package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	localModelDownloadTimeout      = 30 * time.Minute
	localModelDownloadMaxBodyBytes = 64 << 30
)

type managedDownloadedModelSpec struct {
	modelID            string
	logicalModelID     string
	capabilities       []string
	engine             string
	entry              string
	files              []string
	license            string
	repo               string
	revision           string
	hashes             map[string]string
	endpoint           string
	mode               runtimev1.LocalEngineRuntimeMode
	engineConfig       *structpb.Struct
	projectionOverride *modelregistry.NativeProjection
}

func (s *Service) installManagedDownloadedModel(
	ctx context.Context,
	spec managedDownloadedModelSpec,
) (*runtimev1.LocalModelRecord, error) {
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
	if len(files) == 0 {
		files = []string{strings.TrimSpace(spec.entry)}
	}
	if len(files) == 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: "downloaded model requires at least one file",
		})
	}
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	logicalModelID := strings.TrimSpace(spec.logicalModelID)
	if logicalModelID == "" {
		logicalModelID = filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID(modelID)))
	}
	modelDir := runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	stagingDir := modelDir + "-staging-" + strings.ToLower(ulid.Make().String())
	if err := os.RemoveAll(stagingDir); err != nil {
		return nil, fmt.Errorf("cleanup model staging dir: %w", err)
	}
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return nil, fmt.Errorf("create model staging dir: %w", err)
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

	s.updateTransferProgress(transferID, "manifest", 0, 0, "writing model manifest")
	if err := writeModelManifest(manifestPathForStaging(stagingDir), managedModelManifestDescriptor{
		modelID:            modelID,
		logicalModelID:     logicalModelID,
		capabilities:       spec.capabilities,
		engine:             spec.engine,
		entry:              spec.entry,
		files:              files,
		license:            spec.license,
		repo:               spec.repo,
		revision:           spec.revision,
		hashes:             actualHashes,
		endpoint:           spec.endpoint,
		engineConfig:       spec.engineConfig,
		projectionOverride: spec.projectionOverride,
		integrityMode:      "verified",
	}); err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}

	if err := os.RemoveAll(modelDir); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("remove existing model dir: %v", err), false)
		return nil, fmt.Errorf("remove existing model dir: %w", err)
	}
	if err := os.Rename(stagingDir, modelDir); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("commit model install: %v", err), false)
		return nil, fmt.Errorf("commit model install: %w", err)
	}
	success = true

	s.updateTransferProgress(transferID, "register", 0, 0, "registering model")
	record, err := s.installLocalModelRecord(
		modelID,
		spec.capabilities,
		spec.engine,
		spec.entry,
		spec.license,
		spec.repo,
		spec.revision,
		actualHashes,
		spec.endpoint,
		spec.mode,
		"",
		spec.engineConfig,
		spec.projectionOverride,
		"runtime_model_ready_after_install",
		"model installed",
	)
	if err != nil {
		_ = os.RemoveAll(modelDir)
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	s.completeTransfer(transferID, "register", "model installed", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.LocalModelId = record.GetLocalModelId()
		summary.ModelId = record.GetModelId()
	})
	return record, nil
}

func manifestPathForStaging(stagingDir string) string {
	return filepath.Join(stagingDir, "manifest.json")
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
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return "", fmt.Errorf("build model download request: %w", err)
	}
	timeout := s.modelDownloadTimeout
	if timeout <= 0 {
		timeout = localModelDownloadTimeout
	}
	resp, err := (&http.Client{Timeout: timeout}).Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("download model file %q: %w", relativeFile, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download model file %q status=%d", relativeFile, resp.StatusCode)
	}
	maxBodyBytes := s.modelDownloadMaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = localModelDownloadMaxBodyBytes
	}
	if resp.ContentLength > 0 {
		_ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
			summary.Phase = "download"
			summary.BytesReceived = 0
			summary.BytesTotal = resp.ContentLength
			summary.Message = "downloading " + relativeFile
			summary.State = localTransferStateRunning
		})
	}
	actualHash, _, err := s.downloadToFileWithTransfer(ctx, sessionID, "download", resp.Body, targetPath, maxBodyBytes)
	if err != nil {
		return "", fmt.Errorf("write model file %q: %w", relativeFile, err)
	}
	if expectedHash := expectedModelSHA256(hashes, relativeFile); expectedHash != "" && !strings.EqualFold(expectedHash, actualHash) {
		return "", fmt.Errorf("model file %q hash mismatch: expected=%s actual=%s", relativeFile, expectedHash, actualHash)
	}
	return actualHash, nil
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
	modelID            string
	logicalModelID     string
	capabilities       []string
	engine             string
	entry              string
	files              []string
	license            string
	repo               string
	revision           string
	hashes             map[string]string
	endpoint           string
	engineConfig       *structpb.Struct
	projectionOverride *modelregistry.NativeProjection
	integrityMode      string
}

func writeModelManifest(manifestPath string, descriptor managedModelManifestDescriptor) error {
	manifest := map[string]any{
		"schemaVersion":    "1.0.0",
		"model_id":         descriptor.modelID,
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
	if endpoint := strings.TrimSpace(descriptor.endpoint); endpoint != "" {
		manifest["endpoint"] = endpoint
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
