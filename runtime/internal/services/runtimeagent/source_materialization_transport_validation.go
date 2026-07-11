package runtimeagent

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func authenticateSourceMaterializationRequest(ctx context.Context, requestContext *runtimev1.AgentRequestContext, requireEmptyLocalAgentRef bool) (string, *runtimev1.AgentRequestContext, error) {
	identity := authn.IdentityFromContext(ctx)
	if identity == nil || strings.TrimSpace(identity.SubjectUserID) == "" {
		return "", nil, status.Error(codes.Unauthenticated, "authenticated materializer account is required")
	}
	if requestContext == nil {
		return "", nil, status.Error(codes.InvalidArgument, "agent request context is required")
	}
	accountID := identity.SubjectUserID
	if accountID != strings.TrimSpace(accountID) || requestContext.GetSubjectUserId() != accountID || requestContext.GetOwnerUserId() != accountID {
		return "", nil, status.Error(codes.PermissionDenied, "source materialization account binding mismatch")
	}
	if requestContext.GetAppId() == "" || requestContext.GetAppId() != strings.TrimSpace(requestContext.GetAppId()) {
		return "", nil, status.Error(codes.InvalidArgument, "source materialization app_id is required")
	}
	if requireEmptyLocalAgentRef && requestContext.GetLocalAgentRef() != "" {
		return "", nil, status.Error(codes.InvalidArgument, "pre-commit source materialization context must not carry local_agent_ref")
	}
	return accountID, requestContext, nil
}

func validateSourceMaterializationSourceRef(in *runtimev1.SourceMaterializationSourceRef) (*runtimev1.SourceMaterializationSourceRef, error) {
	if in == nil {
		return nil, fmt.Errorf("source ref is required")
	}
	switch in.GetKind() {
	case runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_WORLD_CHARACTER,
		runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_REALM_PERSONA:
	default:
		return nil, fmt.Errorf("source kind is invalid")
	}
	worldID := in.GetWorldId()
	sourceID := in.GetSourceId()
	sourceHash := in.GetSourceContentHash()
	if worldID == "" || sourceID == "" || worldID != strings.TrimSpace(worldID) || sourceID != strings.TrimSpace(sourceID) || strings.ContainsAny(worldID, ":\x00\r\n\t") || strings.ContainsAny(sourceID, ":\x00\r\n\t") || sourceHash != strings.TrimSpace(sourceHash) || !validSHA256Hex(sourceHash) || len(worldID) > maxSourceMaterializationIdentifierBytes || len(sourceID) > maxSourceMaterializationIdentifierBytes {
		return nil, fmt.Errorf("source ref fields are invalid")
	}
	return &runtimev1.SourceMaterializationSourceRef{Kind: in.GetKind(), WorldId: worldID, SourceId: sourceID, SourceContentHash: sourceHash}, nil
}

func runtimeSourceRefForMaterialization(sourceRef *runtimev1.SourceMaterializationSourceRef) string {
	if sourceRef == nil {
		return ""
	}
	kind := ""
	switch sourceRef.GetKind() {
	case runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_WORLD_CHARACTER:
		kind = "worldCharacter"
	case runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_REALM_PERSONA:
		kind = "realmPersona"
	default:
		return ""
	}
	return "runtime-source:" + kind + ":" + sourceRef.GetWorldId() + ":" + sourceRef.GetSourceId() + ":" + sourceRef.GetSourceContentHash()
}

func defaultSourceMaterializationLimits() *runtimev1.SourceMaterializationChallengeLimits {
	return &runtimev1.SourceMaterializationChallengeLimits{
		MaxBundleBytes:    defaultSourceMaterializationMaxBundleBytes,
		MaxComponentCount: defaultSourceMaterializationMaxComponentCount,
		MaxChunkBytes:     defaultSourceMaterializationMaxChunkBytes,
		MaxChunks:         defaultSourceMaterializationMaxChunks,
	}
}

func sourceMaterializationBinding(record sourceMaterializationChallengeRecord) sourceMaterializationChallengeBindingV2 {
	return sourceMaterializationChallengeBindingV2{
		RuntimeInstanceID:       record.RuntimeInstanceID,
		MaterializerAccountID:   record.MaterializerAccountID,
		ChallengeID:             record.ChallengeID,
		IntendedRuntimeAudience: record.IntendedRuntimeAudience,
		ChallengeDigest:         record.ChallengeDigest,
		SourceRef:               record.SourceRef,
		Limits:                  record.Limits,
		IssuedAt:                record.IssuedAt,
		ExpiresAt:               record.ExpiresAt,
	}
}

func validateSourceMaterializationBeginControl(control *runtimev1.SourceMaterializationBeginControl, binding sourceMaterializationChallengeBindingV2, now time.Time) runtimev1.AgentSourceMaterializationReasonCode {
	if control == nil || control.GetPacketEnvelope() == nil || control.GetBundleTransportManifest() == nil || strings.TrimSpace(control.GetPacketProof()) == "" {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST
	}
	envelope := control.GetPacketEnvelope()
	manifest := control.GetBundleTransportManifest()
	if envelope.GetPacketSchemaVersion() != runtimev1.AgentSourceMaterializationPacketSchemaVersion_AGENT_SOURCE_MATERIALIZATION_PACKET_SCHEMA_VERSION_V2 || envelope.GetAlgorithm() != runtimev1.AgentSourceMaterializationProofAlgorithm_AGENT_SOURCE_MATERIALIZATION_PROOF_ALGORITHM_RS256 || envelope.GetKeyUse() != runtimev1.AgentSourceMaterializationKeyUse_AGENT_SOURCE_MATERIALIZATION_KEY_USE_SIG {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID
	}
	if strings.TrimSpace(envelope.GetPacketId()) == "" || strings.TrimSpace(envelope.GetIssuer()) == "" || strings.TrimSpace(envelope.GetKeyId()) == "" || strings.TrimSpace(envelope.GetNonce()) == "" || !validSHA256Hex(envelope.GetPayloadHash()) || !validSHA256Hex(envelope.GetBundleManifestHash()) || !validSHA256Hex(envelope.GetPacketHash()) {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID
	}
	if envelope.GetChallengeId() != binding.ChallengeID || envelope.GetChallengeDigest() != binding.ChallengeDigest {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT
	}
	if envelope.GetIntendedRuntimeAudience() != binding.IntendedRuntimeAudience {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_AUDIENCE_MISMATCH
	}
	if envelope.GetMaterializerAccountId() != binding.MaterializerAccountID {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ACCOUNT_BINDING_MISMATCH
	}
	if !sameSourceMaterializationSourceRef(envelope.GetSourceRef(), binding.SourceRef) {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_SOURCE_BINDING_MISMATCH
	}
	if !sameSourceMaterializationLimits(envelope.GetChallengeLimits(), binding.Limits) {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_CONFLICT
	}
	if envelope.GetIssuedAt() == nil || envelope.GetExpiresAt() == nil || !envelope.GetIssuedAt().IsValid() || !envelope.GetExpiresAt().IsValid() {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID
	}
	issuedAt := envelope.GetIssuedAt().AsTime().UTC()
	expiresAt := envelope.GetExpiresAt().AsTime().UTC()
	if issuedAt.Before(binding.IssuedAt) || expiresAt.After(binding.ExpiresAt) || !issuedAt.Before(expiresAt) || !now.Before(expiresAt) || !now.Before(binding.ExpiresAt) {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_EXPIRED
	}
	if manifest.GetManifestSchemaVersion() != runtimev1.AgentSourceMaterializationBundleManifestSchemaVersion_AGENT_SOURCE_MATERIALIZATION_BUNDLE_MANIFEST_SCHEMA_VERSION_V1 || manifest.GetPayloadAssemblyVersion() != runtimev1.AgentSourceMaterializationPayloadAssemblyVersion_AGENT_SOURCE_MATERIALIZATION_PAYLOAD_ASSEMBLY_VERSION_V1 || manifest.GetPacketId() != envelope.GetPacketId() || manifest.GetChallengeDigest() != binding.ChallengeDigest {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID
	}
	_, reason := sourceMaterializationChunkLayout(manifest, binding.Limits)
	return reason
}

func sourceMaterializationChunkLayout(manifest *runtimev1.BundleTransportManifestV1, limits *runtimev1.SourceMaterializationChallengeLimits) (map[uint32]sourceMaterializationExpectedChunk, runtimev1.AgentSourceMaterializationReasonCode) {
	if manifest == nil || limits == nil || manifest.GetComponentCount() != uint32(len(manifest.GetComponents())) || manifest.GetChunkCount() != uint32(len(manifest.GetChunks())) || len(manifest.GetComponents()) == 0 || len(manifest.GetChunks()) == 0 {
		return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID
	}
	if manifest.GetTotalCanonicalBytes() > limits.GetMaxBundleBytes() {
		return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_BUNDLE_CAPACITY_EXCEEDED
	}
	if manifest.GetComponentCount() > limits.GetMaxComponentCount() {
		return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMPONENT_CAPACITY_EXCEEDED
	}
	if manifest.GetChunkCount() > limits.GetMaxChunks() {
		return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_COUNT_EXCEEDED
	}
	componentIDs := make(map[string]struct{}, len(manifest.GetComponents()))
	var componentBytes uint64
	for _, component := range manifest.GetComponents() {
		componentID := strings.TrimSpace(component.GetComponentId())
		if componentID == "" || len(componentID) > maxSourceMaterializationIdentifierBytes {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID
		}
		if _, exists := componentIDs[componentID]; exists {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID
		}
		componentIDs[componentID] = struct{}{}
		if !validSourceMaterializationComponentKind(component.GetKind()) || strings.TrimSpace(component.GetSchemaVersion()) == "" || !validSHA256Hex(component.GetContentHash()) || !validSHA256Hex(component.GetCanonicalBytesHash()) || component.GetCanonicalByteLength() == 0 {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID
		}
		if componentBytes > ^uint64(0)-component.GetCanonicalByteLength() {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_BUNDLE_CAPACITY_EXCEEDED
		}
		componentBytes += component.GetCanonicalByteLength()
	}
	if componentBytes != manifest.GetTotalCanonicalBytes() {
		return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_MANIFEST_INVALID
	}
	layout := make(map[uint32]sourceMaterializationExpectedChunk, len(manifest.GetChunks()))
	componentIndex := 0
	var expectedOffset uint64
	var chunkBytes uint64
	for index, chunk := range manifest.GetChunks() {
		if componentIndex >= len(manifest.GetComponents()) || chunk.GetGlobalOrdinal() != uint32(index) || chunk.GetLength() == 0 || chunk.GetLength() > limits.GetMaxChunkBytes() || chunk.GetComponentOffset() != expectedOffset || !validSHA256Hex(chunk.GetChunkSha256()) {
			reason := runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DESCRIPTOR_INVALID
			if chunk.GetLength() > limits.GetMaxChunkBytes() {
				reason = runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_CAPACITY_EXCEEDED
			}
			return nil, reason
		}
		component := manifest.GetComponents()[componentIndex]
		remaining := component.GetCanonicalByteLength() - expectedOffset
		if chunk.GetLength() > remaining {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DESCRIPTOR_INVALID
		}
		layout[chunk.GetGlobalOrdinal()] = sourceMaterializationExpectedChunk{ComponentID: component.GetComponentId(), Offset: expectedOffset, Length: chunk.GetLength(), SHA256: strings.ToLower(chunk.GetChunkSha256())}
		expectedOffset += chunk.GetLength()
		if chunkBytes > ^uint64(0)-chunk.GetLength() {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_BUNDLE_CAPACITY_EXCEEDED
		}
		chunkBytes += chunk.GetLength()
		if expectedOffset == component.GetCanonicalByteLength() {
			componentIndex++
			expectedOffset = 0
		}
	}
	if componentIndex != len(manifest.GetComponents()) || expectedOffset != 0 || chunkBytes != manifest.GetTotalCanonicalBytes() {
		return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DESCRIPTOR_INVALID
	}
	return layout, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
}

func validSourceMaterializationComponentKind(kind runtimev1.AgentSourceMaterializationComponentKind) bool {
	switch kind {
	case runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CHARACTER,
		runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_REALM_PERSONA,
		runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CORE,
		runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_ENTITY,
		runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_RELATIONSHIP,
		runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_COVERAGE_MANIFEST:
		return true
	default:
		return false
	}
}

func assembleSourceMaterializationComponents(manifest *runtimev1.BundleTransportManifestV1, limits *runtimev1.SourceMaterializationChallengeLimits, chunks []sourceMaterializationChunkRecord) (map[string][]byte, runtimev1.AgentSourceMaterializationReasonCode) {
	layout, reason := sourceMaterializationChunkLayout(manifest, limits)
	if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
		return nil, reason
	}
	if len(chunks) != len(layout) {
		return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DESCRIPTOR_INVALID
	}
	components := make(map[string][]byte, len(manifest.GetComponents()))
	for index, chunk := range chunks {
		expected, ok := layout[uint32(index)]
		if !ok || chunk.GlobalOrdinal != uint32(index) || chunk.ComponentID != expected.ComponentID || chunk.ComponentOffset != expected.Offset || uint64(len(chunk.Bytes)) != expected.Length || chunk.ChunkSHA256 != expected.SHA256 || sourceMaterializationBytesDigest(chunk.Bytes) != expected.SHA256 {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DESCRIPTOR_INVALID
		}
		components[chunk.ComponentID] = append(components[chunk.ComponentID], chunk.Bytes...)
	}
	for _, component := range manifest.GetComponents() {
		assembled := components[component.GetComponentId()]
		if uint64(len(assembled)) != component.GetCanonicalByteLength() || sourceMaterializationBytesDigest(assembled) != strings.ToLower(component.GetCanonicalBytesHash()) {
			return nil, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHUNK_DIGEST_MISMATCH
		}
	}
	return components, runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
}

func computeSourceMaterializationChallengeDigest(runtimeInstanceID, accountID, challengeID, audience string, sourceRef *runtimev1.SourceMaterializationSourceRef, limits *runtimev1.SourceMaterializationChallengeLimits, expiresAt time.Time) string {
	h := sha256.New()
	_, _ = h.Write(sourceMaterializationChallengeDigestDomain)
	for _, value := range []string{runtimeInstanceID, accountID, challengeID, audience, runtimeSourceRefForMaterialization(sourceRef), formatSourceMaterializationTime(expiresAt)} {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(value)))
		_, _ = h.Write(size[:])
		_, _ = h.Write([]byte(value))
	}
	var limitsBytes [24]byte
	binary.BigEndian.PutUint64(limitsBytes[0:8], limits.GetMaxBundleBytes())
	binary.BigEndian.PutUint32(limitsBytes[8:12], limits.GetMaxComponentCount())
	binary.BigEndian.PutUint64(limitsBytes[12:20], limits.GetMaxChunkBytes())
	binary.BigEndian.PutUint32(limitsBytes[20:24], limits.GetMaxChunks())
	_, _ = h.Write(limitsBytes[:])
	return hex.EncodeToString(h.Sum(nil))
}

func newSourceMaterializationOpaqueID(prefix string) (string, error) {
	var raw [24]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(raw[:]), nil
}

func sourceMaterializationBytesDigest(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func sourceMaterializationNonceDigest(nonce string) string {
	return sourceMaterializationBytesDigest(append(
		[]byte("nimi.runtime.source-materialization-nonce-replay/v1\x00"),
		[]byte(nonce)...,
	))
}

func deterministicSourceMaterializationControlBytes(control *runtimev1.SourceMaterializationBeginControl) ([]byte, error) {
	if control == nil {
		return []byte("nil-control"), nil
	}
	return (proto.MarshalOptions{Deterministic: true}).Marshal(control)
}

func validSHA256Hex(value string) bool {
	if value != strings.TrimSpace(value) || len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validSourceMaterializationRequestID(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= maxSourceMaterializationRequestIDBytes
}

func validSourceMaterializationOpaqueID(value string, prefix string) bool {
	if value != strings.TrimSpace(value) || !strings.HasPrefix(value, prefix) || len(value) != len(prefix)+48 {
		return false
	}
	_, err := hex.DecodeString(value[len(prefix):])
	return err == nil
}

func sameSourceMaterializationLimits(a, b *runtimev1.SourceMaterializationChallengeLimits) bool {
	return a != nil && b != nil && a.GetMaxBundleBytes() == b.GetMaxBundleBytes() && a.GetMaxComponentCount() == b.GetMaxComponentCount() && a.GetMaxChunkBytes() == b.GetMaxChunkBytes() && a.GetMaxChunks() == b.GetMaxChunks()
}

func sourceMaterializationReasonFromError(err error, fallback runtimev1.AgentSourceMaterializationReasonCode) runtimev1.AgentSourceMaterializationReasonCode {
	if err == nil {
		return runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE
	}
	var typed sourceMaterializationReasonError
	if errors.As(err, &typed) {
		reason := typed.SourceMaterializationReasonCode()
		if reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UNSPECIFIED && reason != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
			return reason
		}
	}
	return fallback
}

func sourceMaterializationChallengeResponse(record sourceMaterializationChallengeRecord) *runtimev1.CreateSourceMaterializationChallengeResponse {
	return &runtimev1.CreateSourceMaterializationChallengeResponse{
		ChallengeId:             record.ChallengeID,
		IntendedRuntimeAudience: record.IntendedRuntimeAudience,
		ChallengeDigest:         record.ChallengeDigest,
		ExpiresAt:               timestamppb.New(record.ExpiresAt),
		Limits:                  record.Limits,
		State:                   record.State,
		ReasonCode:              runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
		SourceRef:               record.SourceRef,
		MaterializerAccountId:   record.MaterializerAccountID,
	}
}

func sourceMaterializationChallengeFailure(reason runtimev1.AgentSourceMaterializationReasonCode) *runtimev1.CreateSourceMaterializationChallengeResponse {
	return &runtimev1.CreateSourceMaterializationChallengeResponse{ReasonCode: reason}
}

func sourceMaterializationBeginResponse(upload sourceMaterializationUploadRecord, challengeState runtimev1.AgentSourceMaterializationChallengeState, reason runtimev1.AgentSourceMaterializationReasonCode) *runtimev1.BeginSourceMaterializationUploadResponse {
	return &runtimev1.BeginSourceMaterializationUploadResponse{UploadId: upload.UploadID, PacketHash: upload.PacketHash, BundleManifestHash: upload.BundleManifestHash, UploadState: upload.State, ChallengeState: challengeState, ReasonCode: reason, ExpiresAt: timestamppb.New(upload.ExpiresAt)}
}

func sourceMaterializationBeginFailure(reason runtimev1.AgentSourceMaterializationReasonCode) *runtimev1.BeginSourceMaterializationUploadResponse {
	return &runtimev1.BeginSourceMaterializationUploadResponse{ReasonCode: reason}
}

func sourceMaterializationPutFailure(req *runtimev1.PutSourceMaterializationChunkRequest, state runtimev1.AgentSourceMaterializationUploadState, reason runtimev1.AgentSourceMaterializationReasonCode) *runtimev1.PutSourceMaterializationChunkResponse {
	return &runtimev1.PutSourceMaterializationChunkResponse{UploadId: strings.TrimSpace(req.GetUploadId()), GlobalOrdinal: req.GetGlobalOrdinal(), ComponentId: strings.TrimSpace(req.GetComponentId()), UploadState: state, ReasonCode: reason}
}

func sourceMaterializationCommitFailure(uploadID string, uploadState runtimev1.AgentSourceMaterializationUploadState, challengeState runtimev1.AgentSourceMaterializationChallengeState, reason runtimev1.AgentSourceMaterializationReasonCode) *runtimev1.CommitSourceMaterializationResponse {
	return &runtimev1.CommitSourceMaterializationResponse{UploadId: strings.TrimSpace(uploadID), UploadState: uploadState, ChallengeState: challengeState, ReasonCode: reason}
}

func (s *Service) replaySourceMaterializationCommit(ctx context.Context, upload sourceMaterializationUploadRecord, challenge sourceMaterializationChallengeRecord) (*runtimev1.CommitSourceMaterializationResponse, error) {
	if upload.State != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED ||
		challenge.State != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED ||
		upload.ChallengeID != challenge.ChallengeID || upload.PacketHash != challenge.PacketHash ||
		upload.BundleManifestHash != challenge.BundleManifestHash {
		return nil, status.Error(codes.DataLoss, "committed source materialization ledger binding is invalid")
	}
	snapshot, found, err := s.sourceMaterializationRepo.sourceSnapshot(ctx, upload.CommittedLocalAgentRef)
	if err != nil {
		return nil, status.Errorf(codes.DataLoss, "read committed source materialization snapshot: %v", err)
	}
	if !found || snapshot.PacketHash != upload.PacketHash ||
		!sameSourceMaterializationSourceRef(sourceMaterializationProtoRefFromSnapshot(snapshot.SourceRef), challenge.SourceRef) {
		return nil, status.Error(codes.DataLoss, "committed source materialization snapshot binding is invalid")
	}
	if err := s.sourceMaterializationRepo.validateSourceSnapshotProvenance(ctx, snapshot); err != nil {
		return nil, status.Errorf(codes.DataLoss, "committed source materialization provenance is invalid: %v", err)
	}
	projection := &runtimev1.LocalAgentSourceContextStatus{}
	expectedProjection := localAgentSourceContextStatus(snapshot)
	if upload.CommittedLocalAgentRef == "" || len(upload.CommittedSourceContextBytes) == 0 ||
		proto.Unmarshal(upload.CommittedSourceContextBytes, projection) != nil ||
		!proto.Equal(projection, expectedProjection) {
		return nil, status.Error(codes.DataLoss, "committed source materialization result is invalid")
	}
	return &runtimev1.CommitSourceMaterializationResponse{UploadId: upload.UploadID, LocalAgentRef: upload.CommittedLocalAgentRef, UploadState: upload.State, ChallengeState: challenge.State, ReasonCode: runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE, SourceContextStatus: projection}, nil
}

func sourceMaterializationAbortFailure(uploadID string, uploadState runtimev1.AgentSourceMaterializationUploadState, challengeState runtimev1.AgentSourceMaterializationChallengeState, reason runtimev1.AgentSourceMaterializationReasonCode) *runtimev1.AbortSourceMaterializationUploadResponse {
	return &runtimev1.AbortSourceMaterializationUploadResponse{UploadId: strings.TrimSpace(uploadID), UploadState: uploadState, ChallengeState: challengeState, ReasonCode: reason}
}
