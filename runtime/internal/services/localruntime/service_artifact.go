package localruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) ListLocalArtifacts(_ context.Context, req *runtimev1.ListLocalArtifactsRequest) (*runtimev1.ListLocalArtifactsResponse, error) {
	statusFilter := req.GetStatusFilter()
	kindFilter := req.GetKindFilter()
	engineFilter := strings.ToLower(strings.TrimSpace(req.GetEngineFilter()))

	s.mu.RLock()
	defer s.mu.RUnlock()

	artifacts := make([]*runtimev1.LocalArtifactRecord, 0, len(s.artifacts))
	for _, artifact := range s.artifacts {
		if artifact == nil {
			continue
		}
		if statusFilter != runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_UNSPECIFIED && artifact.GetStatus() != statusFilter {
			continue
		}
		if kindFilter != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED && artifact.GetKind() != kindFilter {
			continue
		}
		if engineFilter != "" && !strings.EqualFold(strings.TrimSpace(artifact.GetEngine()), engineFilter) {
			continue
		}
		artifacts = append(artifacts, cloneLocalArtifact(artifact))
	}

	sort.Slice(artifacts, func(i, j int) bool {
		if artifacts[i].GetKind() != artifacts[j].GetKind() {
			return artifacts[i].GetKind() < artifacts[j].GetKind()
		}
		if artifacts[i].GetArtifactId() != artifacts[j].GetArtifactId() {
			return artifacts[i].GetArtifactId() < artifacts[j].GetArtifactId()
		}
		return artifacts[i].GetLocalArtifactId() < artifacts[j].GetLocalArtifactId()
	})

	filterDigest := pagination.FilterDigest(statusFilter.String(), kindFilter.String(), engineFilter)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, req.GetPageSize(), 50, 200, len(artifacts))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListLocalArtifactsResponse{
		Artifacts:     artifacts[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) ListVerifiedArtifacts(_ context.Context, req *runtimev1.ListVerifiedArtifactsRequest) (*runtimev1.ListVerifiedArtifactsResponse, error) {
	kindFilter := req.GetKindFilter()
	engineFilter := strings.ToLower(strings.TrimSpace(req.GetEngineFilter()))

	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]*runtimev1.LocalVerifiedArtifactDescriptor, 0, len(s.verifiedArtifacts))
	for _, item := range s.verifiedArtifacts {
		if item == nil {
			continue
		}
		if kindFilter != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED && item.GetKind() != kindFilter {
			continue
		}
		if engineFilter != "" && !strings.EqualFold(strings.TrimSpace(item.GetEngine()), engineFilter) {
			continue
		}
		items = append(items, cloneVerifiedArtifact(item))
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].GetTemplateId() < items[j].GetTemplateId()
	})

	filterDigest := pagination.FilterDigest(kindFilter.String(), engineFilter)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, req.GetPageSize(), 50, 200, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListVerifiedArtifactsResponse{
		Artifacts:     items[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) InstallVerifiedArtifact(ctx context.Context, req *runtimev1.InstallVerifiedArtifactRequest) (*runtimev1.InstallVerifiedArtifactResponse, error) {
	templateID := strings.TrimSpace(req.GetTemplateId())
	if templateID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND)
	}

	s.mu.RLock()
	var matched *runtimev1.LocalVerifiedArtifactDescriptor
	for _, item := range s.verifiedArtifacts {
		if item != nil && item.GetTemplateId() == templateID {
			matched = item
			break
		}
	}
	s.mu.RUnlock()
	if matched == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND)
	}

	record, err := s.installVerifiedArtifactFromHuggingFace(ctx, matched)
	if err != nil {
		return nil, err
	}
	return &runtimev1.InstallVerifiedArtifactResponse{Artifact: record}, nil
}

func (s *Service) ImportLocalArtifact(_ context.Context, req *runtimev1.ImportLocalArtifactRequest) (*runtimev1.ImportLocalArtifactResponse, error) {
	manifestPath := strings.TrimSpace(req.GetManifestPath())
	if manifestPath == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	content, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}

	var manifest map[string]any
	if err := json.Unmarshal(content, &manifest); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}

	artifactID, ok := manifestString(manifest, "artifact_id", "artifactId")
	if !ok || strings.TrimSpace(artifactID) == "" {
		base := strings.TrimSuffix(filepath.Base(manifestPath), filepath.Ext(manifestPath))
		artifactID = strings.TrimSpace(base)
	}
	if artifactID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}

	kind, err := manifestArtifactKind(manifest)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	engine := defaultString(manifestStringDefault(manifest, "engine"), "localai")
	entry := strings.TrimSpace(manifestStringDefault(manifest, "entry"))
	if entry == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	files, err := manifestStringSlice(manifest, "files")
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	if len(files) == 0 {
		files = []string{entry}
	}
	hashes, err := manifestStringMap(manifest, "hashes")
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	metadata, err := manifestStruct(manifest, "metadata")
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	repo := manifestStringDefault(manifest, "repo")
	revision := defaultString(manifestStringDefault(manifest, "revision"), "import")
	if sourceValue, ok := manifest["source"]; ok {
		sourceObject, objectOK := sourceValue.(map[string]any)
		if !objectOK {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
		}
		if sourceRepo, ok := manifestString(sourceObject, "repo"); ok {
			repo = sourceRepo
		}
		if sourceRevision, ok := manifestString(sourceObject, "revision"); ok {
			revision = sourceRevision
		}
	}
	if repo == "" {
		repo = "file://" + manifestPath
	}

	record, err := s.installLocalArtifactRecord(&runtimev1.LocalArtifactRecord{
		LocalArtifactId: ulid.Make().String(),
		ArtifactId:      artifactID,
		Kind:            kind,
		Engine:          engine,
		Entry:           entry,
		Files:           files,
		License:         defaultString(manifestStringDefault(manifest, "license"), "unknown"),
		Source: &runtimev1.LocalArtifactSource{
			Repo:     repo,
			Revision: revision,
		},
		Hashes:      hashes,
		Status:      runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_INSTALLED,
		InstalledAt: nowISO(),
		UpdatedAt:   nowISO(),
		Metadata:    metadata,
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.ImportLocalArtifactResponse{Artifact: record}, nil
}

func (s *Service) RemoveLocalArtifact(_ context.Context, req *runtimev1.RemoveLocalArtifactRequest) (*runtimev1.RemoveLocalArtifactResponse, error) {
	localArtifactID := strings.TrimSpace(req.GetLocalArtifactId())
	if localArtifactID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "local artifact id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.artifacts[localArtifactID]
	if current == nil {
		return nil, status.Errorf(codes.NotFound, "local artifact %s not found", localArtifactID)
	}
	updated := cloneLocalArtifact(current)
	updated.Status = runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_REMOVED
	updated.HealthDetail = "artifact removed"
	updated.UpdatedAt = nowISO()
	s.artifacts[localArtifactID] = updated
	s.persistStateLocked()
	return &runtimev1.RemoveLocalArtifactResponse{Artifact: cloneLocalArtifact(updated)}, nil
}

func (s *Service) installLocalArtifactRecord(record *runtimev1.LocalArtifactRecord) (*runtimev1.LocalArtifactRecord, error) {
	if record == nil || strings.TrimSpace(record.GetArtifactId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	now := nowISO()
	if strings.TrimSpace(record.GetInstalledAt()) == "" {
		record.InstalledAt = now
	}
	record.UpdatedAt = now

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.artifacts {
		if existing == nil || existing.GetStatus() == runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_REMOVED {
			continue
		}
		if existing.GetArtifactId() == record.GetArtifactId() &&
			existing.GetKind() == record.GetKind() &&
			strings.EqualFold(existing.GetEngine(), record.GetEngine()) {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED)
		}
	}
	stored := cloneLocalArtifact(record)
	s.artifacts[stored.GetLocalArtifactId()] = stored
	s.persistStateLocked()
	return cloneLocalArtifact(stored), nil
}

func manifestArtifactKind(manifest map[string]any) (runtimev1.LocalArtifactKind, error) {
	value, ok := manifestString(manifest, "kind")
	if !ok {
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED, fmt.Errorf("kind is required")
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "vae":
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_VAE, nil
	case "llm":
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LLM, nil
	case "clip":
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_CLIP, nil
	case "controlnet":
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_CONTROLNET, nil
	case "lora":
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LORA, nil
	case "auxiliary", "aux":
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_AUXILIARY, nil
	default:
		return runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED, fmt.Errorf("unsupported kind %q", value)
	}
}
