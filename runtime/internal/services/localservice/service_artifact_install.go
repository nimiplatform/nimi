package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

const defaultHFDownloadBaseURL = "https://huggingface.co"

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

	record, err := s.downloadVerifiedArtifact(ctx, descriptor)
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
		return nil, err
	}
	return stored, nil
}

func (s *Service) ensureArtifactNotInstalled(
	artifactID string,
	kind runtimev1.LocalArtifactKind,
	engine string,
) error {
	normalizedArtifactID := strings.TrimSpace(artifactID)
	normalizedEngine := strings.TrimSpace(engine)

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, existing := range s.artifacts {
		if existing == nil || existing.GetStatus() == runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_REMOVED {
			continue
		}
		if existing.GetArtifactId() == normalizedArtifactID &&
			existing.GetKind() == kind &&
			strings.EqualFold(existing.GetEngine(), normalizedEngine) {
			return grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED)
		}
	}
	return nil
}

func (s *Service) downloadVerifiedArtifact(
	ctx context.Context,
	descriptor *runtimev1.LocalVerifiedArtifactDescriptor,
) (*runtimev1.LocalArtifactRecord, error) {
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	artifactDir, err := resolveVerifiedArtifactDir(modelsRoot, descriptor.GetArtifactId())
	if err != nil {
		return nil, err
	}
	stagingDir := artifactDir + "-staging-" + strings.ToLower(ulid.Make().String())
	if err := os.RemoveAll(stagingDir); err != nil {
		return nil, fmt.Errorf("cleanup artifact staging dir: %w", err)
	}
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return nil, fmt.Errorf("create artifact staging dir: %w", err)
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
		return nil, fmt.Errorf("verified artifact %q has no install files", strings.TrimSpace(descriptor.GetTemplateId()))
	}

	actualHashes := make(map[string]string, len(files))
	for _, file := range files {
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			return nil, err
		}
		targetPath := filepath.Join(stagingDir, filepath.FromSlash(relativeFile))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return nil, fmt.Errorf("create artifact file dir %q: %w", relativeFile, err)
		}
		fileHash, err := s.downloadVerifiedArtifactFile(ctx, descriptor, relativeFile, targetPath)
		if err != nil {
			return nil, err
		}
		actualHashes[relativeFile] = "sha256:" + fileHash
	}

	manifestPath := filepath.Join(stagingDir, "artifact.manifest.json")
	if err := writeArtifactManifest(manifestPath, descriptor, actualHashes); err != nil {
		return nil, err
	}

	if err := os.RemoveAll(artifactDir); err != nil {
		return nil, fmt.Errorf("remove existing artifact dir: %w", err)
	}
	if err := os.Rename(stagingDir, artifactDir); err != nil {
		return nil, fmt.Errorf("commit artifact install: %w", err)
	}
	success = true

	now := nowISO()
	return &runtimev1.LocalArtifactRecord{
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
	}, nil
}

func (s *Service) downloadVerifiedArtifactFile(
	ctx context.Context,
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
	resp, err := (&http.Client{}).Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("download artifact file %q: %w", relativeFile, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download artifact file %q status=%d", relativeFile, resp.StatusCode)
	}

	tempPath := targetPath + ".download"
	if err := os.RemoveAll(tempPath); err != nil {
		return "", fmt.Errorf("cleanup temp artifact file %q: %w", relativeFile, err)
	}
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", fmt.Errorf("create artifact temp file %q: %w", relativeFile, err)
	}
	hasher := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(file, hasher), resp.Body)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("write artifact file %q: %w", relativeFile, copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("close artifact file %q: %w", relativeFile, closeErr)
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if expectedHash := expectedArtifactSHA256(descriptor.GetHashes(), relativeFile); expectedHash != "" && !strings.EqualFold(expectedHash, actualHash) {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("artifact file %q hash mismatch: expected=%s actual=%s", relativeFile, expectedHash, actualHash)
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("commit artifact file %q: %w", relativeFile, err)
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
	return filepath.Join(rootAbs, slugifyLocalModelID(artifactID)), nil
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
