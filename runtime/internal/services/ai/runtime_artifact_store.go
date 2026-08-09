package ai

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func bindRuntimeJobArtifacts(jobID string, head *runtimev1.ScenarioRequestHead, artifacts []*runtimev1.ScenarioArtifact) ([]*runtimev1.ScenarioArtifact, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" || head == nil || strings.TrimSpace(head.GetAppId()) == "" || strings.TrimSpace(head.GetSubjectUserId()) == "" {
		return nil, fmt.Errorf("runtime artifact producer binding is incomplete")
	}
	out := make([]*runtimev1.ScenarioArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		if artifact == nil || strings.TrimSpace(artifact.GetArtifactId()) == "" {
			return nil, fmt.Errorf("runtime artifact identity is missing")
		}
		cloned, _ := proto.Clone(artifact).(*runtimev1.ScenarioArtifact)
		if cloned == nil {
			return nil, fmt.Errorf("clone runtime artifact")
		}
		if cloned.Metadata == nil {
			cloned.Metadata = &structpb.Struct{Fields: map[string]*structpb.Value{}}
		}
		if cloned.Metadata.Fields == nil {
			cloned.Metadata.Fields = map[string]*structpb.Value{}
		}
		cloned.Metadata.Fields["producer_job_id"] = structpb.NewStringValue(jobID)
		cloned.Metadata.Fields["artifact_custody"] = structpb.NewStringValue("runtime")
		out = append(out, cloned)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("runtime artifact custody requires at least one artifact")
	}
	return out, nil
}

const runtimeCustodyOperationScenarioOutputAttach = "scenario_output_attach"

func (s *Service) storeRuntimeJobArtifacts(
	ctx context.Context,
	jobID string,
	head *runtimev1.ScenarioRequestHead,
	artifacts []*runtimev1.ScenarioArtifact,
	bodies map[string]*capabilitydriver.ArtifactBody,
) ([]string, error) {
	storedIDs := make([]string, 0, len(artifacts))
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		body := bodies[strings.TrimSpace(artifact.GetArtifactId())]
		created, err := s.storeRuntimeJobArtifact(ctx, jobID, head, artifact, body)
		if err != nil {
			capabilitydriver.CloseArtifactBodies(bodies)
			for _, artifactID := range storedIDs {
				s.deleteRuntimeArtifactCandidate(artifactID, "job artifact batch store failed")
			}
			return nil, err
		}
		if created {
			storedIDs = append(storedIDs, artifact.GetArtifactId())
		}
	}
	return storedIDs, nil
}

func (s *Service) storeRuntimeJobArtifact(
	ctx context.Context,
	jobID string,
	head *runtimev1.ScenarioRequestHead,
	artifact *runtimev1.ScenarioArtifact,
	body *capabilitydriver.ArtifactBody,
) (bool, error) {
	if s == nil || s.runtimeArtifacts == nil || head == nil || artifact == nil {
		return false, fmt.Errorf("Runtime artifact custody store is unavailable")
	}
	jobID = strings.TrimSpace(jobID)
	artifactID := strings.TrimSpace(artifact.GetArtifactId())
	owner := s.runtimeArtifactOwnerForJob(jobID, head)
	if jobID == "" || artifactID == "" || owner == nil {
		return false, fmt.Errorf("store Runtime job artifact: producer binding is incomplete")
	}
	if body != nil && body.Kind() == capabilitydriver.ArtifactBodyCommittedReference {
		metadata, err := s.resolveRuntimeCustodyReference(ctx, body.CommittedReference(), owner, runtimeCustodyOperationScenarioOutputAttach)
		if err != nil {
			return false, fmt.Errorf("attach committed Runtime artifact %s: reference validation failed", artifactID)
		}
		if artifactID != strings.TrimSpace(body.CommittedReference().ArtifactID()) {
			return false, fmt.Errorf("attach committed Runtime artifact %s: identity mismatch", artifactID)
		}
		projectCommittedArtifactMetadata(artifact, metadata)
		return false, nil
	}
	if _, exists := s.runtimeArtifacts.Stat(artifactID); exists {
		return false, fmt.Errorf("store Runtime job artifact %s: artifact id already exists", artifactID)
	}
	var source io.ReadCloser
	switch {
	case body == nil:
		payload := artifact.GetBytes()
		if len(payload) == 0 {
			return false, fmt.Errorf("store Runtime job artifact %s: bounded body is missing", artifactID)
		}
		source = io.NopCloser(bytes.NewReader(payload))
	case body.Kind() == capabilitydriver.ArtifactBodyBoundedBytes:
		payload := body.BoundedBytes()
		if len(payload) == 0 || len(artifact.GetBytes()) != 0 {
			return false, fmt.Errorf("store Runtime job artifact %s: bounded body handoff is invalid", artifactID)
		}
		source = io.NopCloser(bytes.NewReader(payload))
	case body.Kind() == capabilitydriver.ArtifactBodyIncrementalStream:
		source = body.TakeIncrementalStream()
		if source == nil || len(artifact.GetBytes()) != 0 {
			return false, fmt.Errorf("store Runtime job artifact %s: incremental body handoff is invalid", artifactID)
		}
	default:
		return false, fmt.Errorf("store Runtime job artifact %s: body handoff is invalid", artifactID)
	}
	if err := s.runtimeArtifacts.PutStream(ctx, artifactID, runtimeartifact.ArtifactRecord{
		MimeType:      artifact.GetMimeType(),
		SizeBytes:     artifact.GetSizeBytes(),
		ContentSHA256: scenarioArtifactDigest(artifact),
		ProducerJobID: jobID,
		Owner:         owner,
	}, source); err != nil {
		return false, fmt.Errorf("store Runtime job artifact %s: %w", artifactID, err)
	}
	metadata, ok := s.runtimeArtifacts.Stat(artifactID)
	if !ok {
		return false, fmt.Errorf("store Runtime job artifact %s: committed metadata is unavailable", artifactID)
	}
	projectCommittedArtifactMetadata(artifact, metadata)
	return true, nil
}

func (s *Service) storeAndAttachRuntimeJobArtifact(
	ctx context.Context,
	jobID string,
	head *runtimev1.ScenarioRequestHead,
	artifact *runtimev1.ScenarioArtifact,
	attach func(*runtimev1.ScenarioArtifact) bool,
) (*runtimev1.ScenarioArtifact, error) {
	return s.storeAndAttachRuntimeJobArtifactBody(ctx, jobID, head, artifact, nil, attach)
}

func (s *Service) storeAndAttachRuntimeJobArtifactBody(
	ctx context.Context,
	jobID string,
	head *runtimev1.ScenarioRequestHead,
	artifact *runtimev1.ScenarioArtifact,
	body *capabilitydriver.ArtifactBody,
	attach func(*runtimev1.ScenarioArtifact) bool,
) (*runtimev1.ScenarioArtifact, error) {
	bound, err := bindRuntimeJobArtifacts(jobID, head, []*runtimev1.ScenarioArtifact{artifact})
	if err != nil {
		return nil, fmt.Errorf("bind Runtime job artifact: %w", err)
	}
	candidate := bound[0]
	created, err := s.storeRuntimeJobArtifact(ctx, jobID, head, candidate, body)
	if err != nil {
		return nil, err
	}
	if attach == nil || !attach(candidate) {
		if created {
			s.deleteRuntimeArtifactCandidate(candidate.GetArtifactId(), "job artifact attach failed")
		}
		return nil, fmt.Errorf("attach Runtime job artifact %s", candidate.GetArtifactId())
	}
	return candidate, nil
}

func (s *Service) storeAndAttachRuntimeJobArtifacts(
	ctx context.Context,
	jobID string,
	head *runtimev1.ScenarioRequestHead,
	artifacts []*runtimev1.ScenarioArtifact,
	attach func([]*runtimev1.ScenarioArtifact) bool,
) ([]*runtimev1.ScenarioArtifact, error) {
	bound, err := bindRuntimeJobArtifacts(jobID, head, artifacts)
	if err != nil {
		return nil, fmt.Errorf("bind Runtime job artifacts: %w", err)
	}
	storedIDs := make([]string, 0, len(bound))
	rollback := func(reason string) {
		for _, artifactID := range storedIDs {
			s.deleteRuntimeArtifactCandidate(artifactID, reason)
		}
	}
	for _, candidate := range bound {
		created, err := s.storeRuntimeJobArtifact(ctx, jobID, head, candidate, nil)
		if err != nil {
			rollback("job artifact batch store failed")
			return nil, err
		}
		if created {
			storedIDs = append(storedIDs, candidate.GetArtifactId())
		}
	}
	if attach == nil || !attach(bound) {
		rollback("job artifact batch attach failed")
		return nil, fmt.Errorf("attach Runtime job artifact batch")
	}
	return bound, nil
}

func (s *Service) issueRuntimeCustodyReference(artifactID string, operation string, ttl time.Duration) (*capabilitydriver.RuntimeCustodyReference, error) {
	if s == nil || s.runtimeArtifacts == nil || s.runtimeCustodyIssuer == nil || ttl <= 0 {
		return nil, fmt.Errorf("Runtime custody issuer is unavailable")
	}
	record, ok := s.runtimeArtifacts.Stat(strings.TrimSpace(artifactID))
	if !ok || record.Owner == nil || strings.TrimSpace(record.Owner.RegisteredAppSubject) == "" {
		return nil, fmt.Errorf("committed Runtime artifact is unavailable")
	}
	return s.runtimeCustodyIssuer.Issue(capabilitydriver.RuntimeCustodyDescriptor{
		ArtifactID: strings.TrimSpace(artifactID), AccountID: record.Owner.SubjectUserID,
		RegisteredAppSubject: record.Owner.RegisteredAppSubject, ProducerAppID: record.Owner.AppID,
		SizeBytes: record.SizeBytes, ContentSHA256: record.ContentSHA256, MIMEType: record.MimeType,
		EligibleOperation: strings.TrimSpace(operation), ExpiresAt: time.Now().UTC().Add(ttl),
	})
}

func (s *Service) resolveRuntimeCustodyReference(
	ctx context.Context,
	reference *capabilitydriver.RuntimeCustodyReference,
	expectedOwner *runtimeartifact.ArtifactOwner,
	operation string,
) (runtimeartifact.ArtifactRecord, error) {
	if s == nil || s.runtimeArtifacts == nil || s.runtimeCustodyIssuer == nil || expectedOwner == nil {
		return runtimeartifact.ArtifactRecord{}, fmt.Errorf("Runtime custody resolver is unavailable")
	}
	descriptor, ok := s.runtimeCustodyIssuer.Resolve(reference)
	if !ok || descriptor.EligibleOperation != strings.TrimSpace(operation) || descriptor.AccountID != expectedOwner.SubjectUserID ||
		descriptor.RegisteredAppSubject != expectedOwner.RegisteredAppSubject || descriptor.ProducerAppID != expectedOwner.AppID {
		return runtimeartifact.ArtifactRecord{}, fmt.Errorf("Runtime custody reference is not eligible")
	}
	record, ok := s.runtimeArtifacts.Stat(descriptor.ArtifactID)
	if !ok || record.Owner == nil || record.Owner.SubjectUserID != descriptor.AccountID ||
		record.Owner.RegisteredAppSubject != descriptor.RegisteredAppSubject || record.Owner.AppID != descriptor.ProducerAppID ||
		record.SizeBytes != descriptor.SizeBytes || !strings.EqualFold(record.ContentSHA256, descriptor.ContentSHA256) ||
		!strings.EqualFold(record.MimeType, descriptor.MIMEType) {
		return runtimeartifact.ArtifactRecord{}, fmt.Errorf("Runtime custody reference metadata changed")
	}
	source, ok := s.runtimeArtifacts.Open(ctx, descriptor.ArtifactID)
	if !ok {
		return runtimeartifact.ArtifactRecord{}, fmt.Errorf("Runtime custody reference integrity failed")
	}
	if err := source.Body.Close(); err != nil {
		return runtimeartifact.ArtifactRecord{}, err
	}
	return record, nil
}

func (s *Service) storeRuntimeOwnedArtifacts(ctx context.Context, owner *runtimeartifact.ArtifactOwner, artifacts []*runtimev1.ScenarioArtifact) error {
	if s == nil || s.runtimeArtifacts == nil {
		return nil
	}
	if owner == nil {
		return fmt.Errorf("store Runtime owned artifact: owner is incomplete")
	}
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		artifactID := strings.TrimSpace(artifact.GetArtifactId())
		if artifactID == "" {
			return fmt.Errorf("store Runtime owned artifact: artifact id is missing")
		}
		payload := artifact.GetBytes()
		if err := s.runtimeArtifacts.PutStream(ctx, artifactID, runtimeartifact.ArtifactRecord{
			MimeType:      artifact.GetMimeType(),
			SizeBytes:     int64(len(payload)),
			ContentSHA256: scenarioArtifactDigest(artifact),
			Owner:         owner,
		}, io.NopCloser(bytes.NewReader(payload))); err != nil {
			return fmt.Errorf("store Runtime owned artifact %s: %w", artifactID, err)
		}
		metadata, ok := s.runtimeArtifacts.Stat(artifactID)
		if !ok {
			return fmt.Errorf("store Runtime owned artifact %s: committed metadata is unavailable", artifactID)
		}
		projectCommittedArtifactMetadata(artifact, metadata)
	}
	return nil
}

func (s *Service) runtimeArtifactOwnerForJob(jobID string, head *runtimev1.ScenarioRequestHead) *runtimeartifact.ArtifactOwner {
	if s != nil && s.scenarioJobs != nil {
		if localOwner, ok := s.scenarioJobs.localAppOwner(jobID); ok {
			return &runtimeartifact.ArtifactOwner{
				SubjectUserID:        localOwner.AccountID,
				RegisteredAppSubject: localOwner.RegisteredAppSubject,
				AppID:                localOwner.ProducerAppID,
			}
		}
	}
	return runtimeArtifactOwner(head)
}

func runtimeArtifactOwnerFromContext(ctx context.Context, head *runtimev1.ScenarioRequestHead) *runtimeartifact.ArtifactOwner {
	if owner := localAppJobOwnerFromContext(ctx); owner != nil {
		return &runtimeartifact.ArtifactOwner{
			SubjectUserID:        owner.AccountID,
			RegisteredAppSubject: owner.RegisteredAppSubject,
			AppID:                owner.ProducerAppID,
		}
	}
	return runtimeArtifactOwner(head)
}

func runtimeArtifactOwner(head *runtimev1.ScenarioRequestHead) *runtimeartifact.ArtifactOwner {
	if head == nil {
		return nil
	}
	owner := &runtimeartifact.ArtifactOwner{
		SubjectUserID: strings.TrimSpace(head.GetSubjectUserId()),
		AppID:         strings.TrimSpace(head.GetAppId()),
	}
	if owner.SubjectUserID == "" || owner.AppID == "" {
		return nil
	}
	return owner
}

func scenarioArtifactDigest(artifact *runtimev1.ScenarioArtifact) string {
	if artifact == nil {
		return ""
	}
	digest := strings.TrimSpace(artifact.GetSha256())
	if digest == "" {
		return ""
	}
	if !strings.HasPrefix(strings.ToLower(digest), "sha256:") {
		digest = "sha256:" + digest
	}
	return digest
}

func projectCommittedArtifactMetadata(artifact *runtimev1.ScenarioArtifact, record runtimeartifact.ArtifactRecord) {
	if artifact == nil {
		return
	}
	artifact.Bytes = nil
	artifact.Uri = ""
	artifact.MimeType = record.MimeType
	artifact.SizeBytes = record.SizeBytes
	artifact.Sha256 = strings.TrimPrefix(strings.ToLower(record.ContentSHA256), "sha256:")
}

func (s *Service) deleteRuntimeArtifactCandidate(artifactID string, reason string) {
	artifactID = strings.TrimSpace(artifactID)
	if s == nil || s.runtimeArtifacts == nil || artifactID == "" {
		return
	}
	if err := s.runtimeArtifacts.Delete(artifactID); err != nil && s.logger != nil {
		s.logger.Warn("delete Runtime artifact compensation failed", "artifact_id", artifactID, "reason", reason, "error", err)
	}
}

func (s *Service) storeRuntimeArtifacts(artifacts []*runtimev1.ScenarioArtifact) error {
	if s == nil || s.runtimeArtifacts == nil {
		return nil
	}
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		artifactID := strings.TrimSpace(artifact.GetArtifactId())
		if artifactID == "" {
			continue
		}
		payload := artifact.GetBytes()
		sizeBytes := artifact.GetSizeBytes()
		if sizeBytes == 0 {
			sizeBytes = int64(len(payload))
		}
		if len(payload) == 0 && sizeBytes > 0 {
			if s.logger != nil {
				s.logger.Warn(
					"skip runtime artifact byte store for metadata-only artifact",
					"artifact_id", artifactID,
					"size_bytes", sizeBytes,
				)
			}
			continue
		}
		if err := s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
			Bytes:     payload,
			MimeType:  artifact.GetMimeType(),
			SizeBytes: sizeBytes,
		}); err != nil {
			return fmt.Errorf("store runtime artifact %s: %w", artifactID, err)
		}
	}
	return nil
}
