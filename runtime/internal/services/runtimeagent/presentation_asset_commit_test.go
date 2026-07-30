package runtimeagent

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestPresentationAssetCommitIsAtomicSharedAndRestorable(t *testing.T) {
	svc, localAgentRef, accountID := newLocalAppConfigureTestAgent(t)
	commitCtx := localAppConfigureContext(accountservice.LocalAppOperationCommitPresentation, localAgentRef, accountID)
	snapshotCtx := localAppConfigureContext(accountservice.LocalAppOperationPresentationSnapshot, localAgentRef, accountID)
	intent := &runtimev1.LocalAppAgentPresentationIntent{BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM}

	invalid := testPresentationVRMMaterialVariant("invalid")
	invalid.Sha256 = strings.Repeat("0", 64)
	_, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 0, Intent: intent,
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{invalid},
	})
	assertPresentationReason(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH, "integrity")
	assertPresentationState(t, svc, snapshotCtx, localAgentRef, 0, "", 0)

	firstMaterial := testPresentationVRMMaterialVariant("first")
	first, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 0, Intent: intent,
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{firstMaterial},
	})
	if err != nil {
		t.Fatalf("local-app commit: %v", err)
	}
	firstRef := first.GetProjection().GetProfile().GetAvatarAssetRef()
	if first.GetProjection().GetPresentationRevision() != 1 || firstRef == "" || first.GetProjection().GetPreviousProfile() != nil {
		t.Fatalf("first committed projection = %#v", first.GetProjection())
	}
	asset, exists, err := svc.presentationAssetByRef(context.Background(), localAgentRef, firstRef)
	if err != nil || !exists || !bytes.Equal(asset.Content, firstMaterial.GetContent()) || asset.SHA256 != firstMaterial.GetSha256() {
		t.Fatalf("official asset query = (%#v, %v, %v)", asset, exists, err)
	}

	staleMaterial := testPresentationVRMMaterialVariant("stale")
	_, err = svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 0, Intent: intent,
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{staleMaterial},
	})
	assertPresentationReason(t, err, codes.Aborted, runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT, "")
	assertPresentationState(t, svc, snapshotCtx, localAgentRef, 1, firstRef, 1)

	entry, err := svc.agentByID(localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	identityContext := &runtimev1.AgentRequestContext{
		AppId: "desktop.app", SubjectUserId: accountID, OwnerUserId: entry.Agent.GetOwnerUserId(),
		RuntimeSourceRef: entry.Agent.GetRuntimeSourceRef(), LocalAgentRef: entry.Agent.GetLocalAgentRef(),
	}
	_, err = svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context: identityContext, ExpectedRevision: uint64Pointer(1),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
			BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM, AvatarAssetRef: "vrm_notvalidated",
		}},
	})
	assertPresentationReason(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_NOT_VALIDATED, "validation")
	assertPresentationState(t, svc, snapshotCtx, localAgentRef, 1, firstRef, 1)

	secondMaterial := testPresentationVRMMaterialVariant("second")
	second, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context: identityContext, ExpectedRevision: uint64Pointer(1), ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{secondMaterial},
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
			BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
		}},
	})
	if err != nil {
		t.Fatalf("first-party commit: %v", err)
	}
	secondRef := second.GetProfile().GetAvatarAssetRef()
	if second.GetCommittedRevision() != 2 || secondRef == firstRef || second.GetPreviousProfile().GetAvatarAssetRef() != firstRef {
		t.Fatalf("second committed projection = %#v", second)
	}
	snapshot, err := svc.GetLocalAppAgentPresentationSnapshot(snapshotCtx, &runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: "lah_v1_opaque"})
	if err != nil || snapshot.GetProjection().GetPreviousProfile().GetAvatarAssetRef() != firstRef {
		t.Fatalf("snapshot previous selection = (%#v, %v)", snapshot, err)
	}

	previous := snapshot.GetProjection().GetPreviousProfile()
	restored, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: "lah_v1_opaque", ExpectedPresentationRevision: 2,
		Intent: &runtimev1.LocalAppAgentPresentationIntent{
			BackendKind: previous.GetBackendKind(), AvatarAssetRef: previous.GetAvatarAssetRef(),
			ExpressionProfileRef: previous.GetExpressionProfileRef(), IdlePreset: previous.GetIdlePreset(),
			InteractionPolicyRef: previous.GetInteractionPolicyRef(), DefaultVoiceReference: previous.GetDefaultVoiceReference(),
			AvatarAutoplay: previous.GetAvatarAutoplay(), BackgroundAssetRef: previous.GetBackgroundAssetRef(),
		},
	})
	if err != nil || restored.GetProjection().GetPresentationRevision() != 3 || restored.GetProjection().GetProfile().GetAvatarAssetRef() != firstRef || restored.GetProjection().GetPreviousProfile().GetAvatarAssetRef() != secondRef {
		t.Fatalf("restore-as-new-commit = (%#v, %v)", restored, err)
	}
	assertPresentationState(t, svc, snapshotCtx, localAgentRef, 3, firstRef, 2)
}

func TestPresentationAssetValidationReasonsAreTyped(t *testing.T) {
	valid := testPresentationVRMMaterialVariant("valid")
	imageMaterial := testPresentationPNGMaterial()
	live2dMissing := testPresentationLive2DMaterial(t, false)
	cases := []struct {
		name     string
		material *runtimev1.AgentPresentationAssetMaterial
		reason   runtimev1.ReasonCode
		category string
	}{
		{name: "type", material: &runtimev1.AgentPresentationAssetMaterial{Role: runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR, FileName: "avatar.bin", MediaType: "application/octet-stream", Content: []byte("not-an-asset"), Sha256: sha256Text([]byte("not-an-asset"))}, reason: runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_TYPE_INVALID, category: "type"},
		{name: "size", material: &runtimev1.AgentPresentationAssetMaterial{Role: runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND, FileName: "background.png", MediaType: "image/png", Content: make([]byte, maxPresentationBackgroundAssetBytes+1)}, reason: runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_TOO_LARGE, category: "size"},
		{name: "structure", material: &runtimev1.AgentPresentationAssetMaterial{Role: runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR, FileName: "avatar.zip", MediaType: "application/zip", Content: []byte("bad zip"), Sha256: sha256Text([]byte("bad zip"))}, reason: runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID, category: "structure"},
		{name: "dependency", material: live2dMissing, reason: runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING, category: "dependency"},
		{name: "integrity", material: func() *runtimev1.AgentPresentationAssetMaterial {
			cloned := proto.Clone(valid).(*runtimev1.AgentPresentationAssetMaterial)
			cloned.Sha256 = strings.Repeat("f", 64)
			return cloned
		}(), reason: runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH, category: "integrity"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.material.GetSha256() == "" {
				tc.material.Sha256 = sha256Text(tc.material.GetContent())
			}
			_, err := validatePresentationAssetMaterials("agent-validation", []*runtimev1.AgentPresentationAssetMaterial{tc.material})
			assertPresentationReason(t, err, codes.InvalidArgument, tc.reason, tc.category)
		})
	}
	validated, err := validatePresentationAssetMaterials("agent-validation", []*runtimev1.AgentPresentationAssetMaterial{imageMaterial})
	if err != nil {
		t.Fatal(err)
	}
	if presentationAssetBackendCompatible(validated[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR], runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM) {
		t.Fatal("image material must not be backend-compatible with VRM")
	}
}

func TestPresentationCarriersCallSingleCommitImplementation(t *testing.T) {
	checks := map[string]string{
		"agent_admin_runtime.go": "r.svc.commitAgentPresentation(",
		"local_app_configure.go": "s.commitAgentPresentation(",
	}
	for file, call := range checks {
		content, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Count(string(content), call) != 1 {
			t.Fatalf("%s must call the shared commit implementation exactly once", file)
		}
	}
}

func assertPresentationState(t *testing.T, svc *Service, snapshotCtx context.Context, localAgentRef string, revision uint64, avatarRef string, assetCount int) {
	t.Helper()
	snapshot, err := svc.GetLocalAppAgentPresentationSnapshot(snapshotCtx, &runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: "lah_v1_opaque"})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.GetProjection().GetPresentationRevision() != revision || snapshot.GetProjection().GetProfile().GetAvatarAssetRef() != avatarRef {
		t.Fatalf("presentation state = %#v, want revision=%d avatar=%q", snapshot.GetProjection(), revision, avatarRef)
	}
	var count int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_agent_presentation_asset WHERE local_agent_ref = ?`, localAgentRef).Scan(&count); err != nil || count != assetCount {
		t.Fatalf("official asset count = %d, err=%v, want %d", count, err, assetCount)
	}
}

func assertPresentationReason(t *testing.T, err error, code codes.Code, reason runtimev1.ReasonCode, category string) {
	t.Helper()
	if status.Code(err) != code {
		t.Fatalf("status code = %s, err=%v, want %s", status.Code(err), err, code)
	}
	if got, ok := grpcerr.ExtractReasonCode(err); !ok || got != reason {
		t.Fatalf("reason = %s, %v, want %s", got, ok, reason)
	}
	if category != "" {
		metadata, ok := grpcerr.ExtractReasonMetadata(err)
		if !ok || metadata["validation_category"] != category {
			t.Fatalf("metadata = %#v, %v, want category %q", metadata, ok, category)
		}
	}
}

func testPresentationVRMMaterialVariant(label string) *runtimev1.AgentPresentationAssetMaterial {
	jsonChunk := []byte(`{"asset":"` + label + `"}`)
	for len(jsonChunk)%4 != 0 {
		jsonChunk = append(jsonChunk, ' ')
	}
	content := make([]byte, 20+len(jsonChunk))
	copy(content[:4], "glTF")
	binary.LittleEndian.PutUint32(content[4:8], 2)
	binary.LittleEndian.PutUint32(content[8:12], uint32(len(content)))
	binary.LittleEndian.PutUint32(content[12:16], uint32(len(jsonChunk)))
	binary.LittleEndian.PutUint32(content[16:20], 0x4e4f534a)
	copy(content[20:], jsonChunk)
	return &runtimev1.AgentPresentationAssetMaterial{Role: runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR, FileName: "avatar.vrm", MediaType: "model/gltf-binary", Content: content, Sha256: sha256Text(content)}
}

func testPresentationPNGMaterial() *runtimev1.AgentPresentationAssetMaterial {
	var content bytes.Buffer
	value := image.NewRGBA(image.Rect(0, 0, 1, 1))
	value.Set(0, 0, color.RGBA{R: 1, G: 2, B: 3, A: 255})
	_ = png.Encode(&content, value)
	return &runtimev1.AgentPresentationAssetMaterial{Role: runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR, FileName: "avatar.png", MediaType: "image/png", Content: content.Bytes(), Sha256: sha256Text(content.Bytes())}
}

func testPresentationLive2DMaterial(t *testing.T, includeTexture bool) *runtimev1.AgentPresentationAssetMaterial {
	t.Helper()
	var content bytes.Buffer
	writer := zip.NewWriter(&content)
	manifest, _ := writer.Create("model/avatar.model3.json")
	_, _ = manifest.Write([]byte(`{"Version":3,"FileReferences":{"Moc":"avatar.moc3","Textures":["avatar.2048/texture_00.png"]}}`))
	moc, _ := writer.Create("model/avatar.moc3")
	_, _ = moc.Write([]byte("moc"))
	if includeTexture {
		texture, _ := writer.Create("model/avatar.2048/texture_00.png")
		_, _ = texture.Write(testPresentationPNGMaterial().GetContent())
	}
	_ = writer.Close()
	return &runtimev1.AgentPresentationAssetMaterial{Role: runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR, FileName: "avatar.zip", MediaType: "application/zip", Content: content.Bytes(), Sha256: sha256Text(content.Bytes())}
}

func sha256Text(content []byte) string {
	digest := sha256.Sum256(content)
	return hex.EncodeToString(digest[:])
}

func uint64Pointer(value uint64) *uint64 { return &value }
