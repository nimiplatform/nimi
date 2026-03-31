package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

const defaultHFDownloadBaseURL = "https://huggingface.co"

const (
	localArtifactDownloadTimeout      = 20 * time.Second
	localArtifactDownloadMaxBodyBytes = 1 << 30
)

func (s *Service) installVerifiedArtifactFromHuggingFace(
	ctx context.Context,
	descriptor *runtimev1.LocalVerifiedArtifactDescriptor,
) (*runtimev1.LocalArtifactRecord, error) {
	if descriptor == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND)
	}
	if err := s.ensureArtifactNotInstalled(descriptor.GetArtifactId(), descriptor.GetKind(), descriptor.GetEngine()); err != nil {
		return nil, err
	}

	record, transferID, err := s.downloadVerifiedArtifact(ctx, descriptor)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message:    err.Error(),
			ActionHint: "retry_local_artifact_install",
		})
	}

	stored, err := s.installLocalArtifactRecord(record)
	if err != nil {
		if artifactDir, dirErr := resolveVerifiedArtifactDir(resolveLocalModelsPath(s.localModelsPath), descriptor.GetArtifactId()); dirErr == nil {
			_ = os.RemoveAll(artifactDir)
		}
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	s.completeTransfer(transferID, "register", "artifact installed", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.ArtifactId = stored.GetArtifactId()
		summary.LocalArtifactId = stored.GetLocalArtifactId()
		summary.ModelId = stored.GetArtifactId()
	})
	return stored, nil
}

func (s *Service) ensureArtifactNotInstalled(
	artifactID string,
	kind runtimev1.LocalArtifactKind,
	engine string,
) error {
	identityKey := localArtifactIdentityKey(artifactID, kind, engine)

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, existing := range s.artifacts {
		if existing == nil || existing.GetStatus() == runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_REMOVED {
			continue
		}
		if localArtifactIdentityKey(existing.GetArtifactId(), existing.GetKind(), existing.GetEngine()) == identityKey {
			return grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED)
		}
	}
	return nil
}

func (s *Service) downloadVerifiedArtifact(
	ctx context.Context,
	descriptor *runtimev1.LocalVerifiedArtifactDescriptor,
) (*runtimev1.LocalArtifactRecord, string, error) {
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	artifactDir, err := resolveVerifiedArtifactDir(modelsRoot, descriptor.GetArtifactId())
	if err != nil {
		return nil, "", err
	}
	stagingDir := artifactDir + "-staging-" + strings.ToLower(ulid.Make().String())
	if err := os.RemoveAll(stagingDir); err != nil {
		return nil, "", fmt.Errorf("cleanup artifact staging dir: %w", err)
	}
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return nil, "", fmt.Errorf("create artifact staging dir: %w", err)
	}

	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(stagingDir)
		}
	}()

	files := normalizeStringSlice(descriptor.GetFiles())
	if len(files) == 0 {
		files = []string{strings.TrimSpace(descriptor.GetEntry())}
	}
	if len(files) == 0 {
		return nil, "", fmt.Errorf("verified artifact %q has no install files", strings.TrimSpace(descriptor.GetTemplateId()))
	}

	actualHashes := make(map[string]string, len(files))
	transfer := s.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID:    descriptor.GetArtifactId(),
		ArtifactID: descriptor.GetArtifactId(),
		Phase:      "download",
		State:      localTransferStateRunning,
		Message:    "downloading verified artifact bundle",
		Retryable:  true,
	})
	transferID := transfer.GetInstallSessionId()
	for _, file := range files {
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			s.failTransfer(transferID, err.Error(), false)
			return nil, transferID, err
		}
		targetPath := filepath.Join(stagingDir, filepath.FromSlash(relativeFile))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			s.failTransfer(transferID, fmt.Sprintf("create artifact file dir %q: %v", relativeFile, err), false)
			return nil, transferID, fmt.Errorf("create artifact file dir %q: %w", relativeFile, err)
		}
		fileHash, err := s.downloadVerifiedArtifactFile(ctx, transferID, descriptor, relativeFile, targetPath)
		if err != nil {
			if errors.Is(err, errLocalTransferCancelled) {
				s.cancelTransfer(transferID, "transfer cancelled")
			} else {
				s.failTransfer(transferID, err.Error(), true)
			}
			return nil, transferID, err
		}
		actualHashes[relativeFile] = "sha256:" + fileHash
	}

	manifestPath := filepath.Join(stagingDir, "artifact.manifest.json")
	s.updateTransferProgress(transferID, "manifest", 0, 0, "writing artifact manifest")
	if err := writeArtifactManifest(manifestPath, descriptor, actualHashes); err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, transferID, err
	}

	if err := os.RemoveAll(artifactDir); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("remove existing artifact dir: %v", err), false)
		return nil, transferID, fmt.Errorf("remove existing artifact dir: %w", err)
	}
	if err := os.Rename(stagingDir, artifactDir); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("commit artifact install: %v", err), false)
		return nil, transferID, fmt.Errorf("commit artifact install: %w", err)
	}
	success = true

	now := nowISO()
	record := &runtimev1.LocalArtifactRecord{
		LocalArtifactId: ulid.Make().String(),
		ArtifactId:      descriptor.GetArtifactId(),
		Kind:            descriptor.GetKind(),
		Engine:          descriptor.GetEngine(),
		Entry:           strings.TrimSpace(descriptor.GetEntry()),
		Files:           append([]string(nil), files...),
		License:         descriptor.GetLicense(),
		Source: &runtimev1.LocalArtifactSource{
			Repo:     descriptor.GetRepo(),
			Revision: defaultString(descriptor.GetRevision(), "main"),
		},
		Hashes:      actualHashes,
		Status:      runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_INSTALLED,
		InstalledAt: now,
		UpdatedAt:   now,
		Metadata:    cloneStruct(descriptor.GetMetadata()),
	}
	s.updateTransferProgress(transferID, "register", 0, 0, "registering artifact")
	return record, transferID, nil
}

func (s *Service) downloadVerifiedArtifactFile(
	ctx context.Context,
	sessionID string,
	descriptor *runtimev1.LocalVerifiedArtifactDescriptor,
	relativeFile string,
	targetPath string,
) (string, error) {
	requestURL, err := buildHFResolveURL(
		defaultString(strings.TrimSpace(s.hfDownloadBaseURL), defaultHFDownloadBaseURL),
		descriptor.GetRepo(),
		defaultString(descriptor.GetRevision(), "main"),
		relativeFile,
	)
	if err != nil {
		return "", err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return "", fmt.Errorf("build artifact download request: %w", err)
	}
	timeout := s.artifactDownloadTimeout
	if timeout <= 0 {
		timeout = localArtifactDownloadTimeout
	}
	resp, err := (&http.Client{Timeout: timeout}).Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("download artifact file %q: %w", relativeFile, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download artifact file %q status=%d", relativeFile, resp.StatusCode)
	}
	maxBodyBytes := s.artifactDownloadMaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = localArtifactDownloadMaxBodyBytes
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
		return "", fmt.Errorf("write artifact file %q: %w", relativeFile, err)
	}
	if expectedHash := expectedArtifactSHA256(descriptor.GetHashes(), relativeFile); expectedHash != "" && !strings.EqualFold(expectedHash, actualHash) {
		return "", fmt.Errorf("artifact file %q hash mismatch: expected=%s actual=%s", relativeFile, expectedHash, actualHash)
	}
	return actualHash, nil
}

func resolveVerifiedArtifactDir(modelsRoot string, artifactID string) (string, error) {
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return "", fmt.Errorf("local models root unavailable")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve local models root: %w", err)
	}
	if err := os.MkdirAll(rootAbs, 0o755); err != nil {
		return "", fmt.Errorf("create local models root: %w", err)
	}
	return filepath.Join(rootAbs, "artifacts", slugifyLocalModelID(artifactID)), nil
}

func normalizeArtifactRelativeFile(value string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(value))
	if clean == "" || clean == "." || clean == ".." || filepath.IsAbs(clean) ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid artifact file path %q", value)
	}
	return filepath.ToSlash(clean), nil
}

func buildHFResolveURL(baseURL string, repo string, revision string, relativeFile string) (string, error) {
	normalizedRepo, err := normalizeHFRepo(repo)
	if err != nil {
		return "", fmt.Errorf("invalid artifact repo %q: %w", repo, err)
	}
	normalizedBase := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if normalizedBase == "" {
		normalizedBase = defaultHFDownloadBaseURL
	}
	result, err := url.JoinPath(normalizedBase, normalizedRepo, "resolve", defaultString(revision, "main"), relativeFile)
	if err != nil {
		return "", fmt.Errorf("build artifact download url: %w", err)
	}
	return result, nil
}

func expectedArtifactSHA256(hashes map[string]string, relativeFile string) string {
	if len(hashes) == 0 {
		return ""
	}
	value := strings.TrimSpace(hashes[relativeFile])
	if value == "" {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(strings.ToLower(value), "sha256:"))
}

func writeArtifactManifest(
	manifestPath string,
	descriptor *runtimev1.LocalVerifiedArtifactDescriptor,
	hashes map[string]string,
) error {
	manifest := map[string]any{
		"schemaVersion": "1.0.0",
		"artifactId":    descriptor.GetArtifactId(),
		"kind":          artifactManifestKindName(descriptor.GetKind()),
		"engine":        descriptor.GetEngine(),
		"entry":         descriptor.GetEntry(),
		"files":         append([]string(nil), descriptor.GetFiles()...),
		"license":       descriptor.GetLicense(),
		"source": map[string]any{
			"repo":     descriptor.GetRepo(),
			"revision": defaultString(descriptor.GetRevision(), "main"),
		},
		"hashes": hashes,
	}
	if descriptor.GetMetadata() != nil {
		rawMetadata, err := protojson.Marshal(descriptor.GetMetadata())
		if err != nil {
			return fmt.Errorf("marshal artifact metadata: %w", err)
		}
		var decoded map[string]any
		if err := json.Unmarshal(rawMetadata, &decoded); err != nil {
			return fmt.Errorf("decode artifact metadata: %w", err)
		}
		manifest["metadata"] = decoded
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal artifact manifest: %w", err)
	}
	if err := os.WriteFile(manifestPath, raw, 0o644); err != nil {
		return fmt.Errorf("write artifact manifest: %w", err)
	}
	return nil
}

func artifactManifestKindName(kind runtimev1.LocalArtifactKind) string {
	switch kind {
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE:
		return "vae"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LLM:
		return "llm"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_CLIP:
		return "clip"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_CONTROLNET:
		return "controlnet"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LORA:
		return "lora"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_AUXILIARY:
		return "auxiliary"
	default:
		return ""
	}
}
