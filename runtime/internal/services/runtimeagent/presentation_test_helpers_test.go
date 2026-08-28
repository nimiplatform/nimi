package runtimeagent

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// setTestAgentPresentationProfile preserves pre-G3 tests whose concern is a
// non-asset presentation invariant. It explicitly installs their synthetic
// refs as Runtime-owned fixtures before invoking the real public mutation.
// New asset-intake tests call SetAgentPresentationProfile directly.
func testPresentationVRMMaterial() *runtimev1.AgentPresentationAssetMaterial {
	jsonChunk := []byte("{}  ")
	content := make([]byte, 20+len(jsonChunk))
	copy(content[:4], "glTF")
	binary.LittleEndian.PutUint32(content[4:8], 2)
	binary.LittleEndian.PutUint32(content[8:12], uint32(len(content)))
	binary.LittleEndian.PutUint32(content[12:16], uint32(len(jsonChunk)))
	binary.LittleEndian.PutUint32(content[16:20], 0x4e4f534a)
	copy(content[20:], jsonChunk)
	digest := sha256.Sum256(content)
	return &runtimev1.AgentPresentationAssetMaterial{
		Role:     runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR,
		FileName: "avatar.vrm", MediaType: "model/gltf-binary", Content: content, Sha256: hex.EncodeToString(digest[:]),
	}
}

func TestPresentationOfficialAssetRefIsStableContentAddressedAndScopeIndependent(t *testing.T) {
	t.Parallel()
	material := testPresentationVRMMaterial()
	first, err := validatePresentationAssetMaterials("local-agent:owner-a:agent-a", []*runtimev1.AgentPresentationAssetMaterial{material})
	if err != nil {
		t.Fatalf("validate first material: %v", err)
	}
	second, err := validatePresentationAssetMaterials("local-agent:owner-b:agent-b", []*runtimev1.AgentPresentationAssetMaterial{material})
	if err != nil {
		t.Fatalf("validate second material: %v", err)
	}
	role := runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR
	if first[role] == nil || second[role] == nil || first[role].ref != second[role].ref {
		t.Fatalf("content-addressed refs differ: first=%+v second=%+v", first[role], second[role])
	}
	if want := "vrm_" + material.GetSha256()[:12]; first[role].ref != want {
		t.Fatalf("asset ref = %q, want %q", first[role].ref, want)
	}
}

func setTestAgentPresentationProfile(svc *Service, ctx context.Context, req *runtimev1.SetAgentPresentationProfileRequest) (*runtimev1.SetAgentPresentationProfileResponse, error) {
	if svc != nil && req != nil {
		localAgentRef := req.GetContext().GetLocalAgentRef()
		backend := runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM
		refs := map[string]runtimev1.AgentPresentationAssetRole{}
		if profile := req.GetProfile(); profile != nil {
			backend = profile.GetBackendKind()
			refs[profile.GetAvatarAssetRef()] = runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR
			refs[profile.GetBackgroundAssetRef()] = runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND
		}
		if patch := req.GetPatch(); patch != nil {
			if patch.BackendKind != nil {
				backend = patch.GetBackendKind()
			}
			if patch.AvatarAssetRef != nil {
				refs[patch.GetAvatarAssetRef()] = runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR
			}
			if patch.BackgroundAssetRef != nil {
				refs[patch.GetBackgroundAssetRef()] = runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND
			}
		}
		_ = svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
			for ref, role := range refs {
				if strings.TrimSpace(ref) == "" {
					continue
				}
				if _, err := tx.Exec(`INSERT OR IGNORE INTO runtime_agent_presentation_asset(asset_ref, local_agent_ref, asset_role, backend_kind, file_name, media_type, sha256, byte_length, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ref, localAgentRef, int32(role), int32(backend), "fixture.vrm", "model/gltf-binary", strings.Repeat("0", 64), 1, []byte{0}, time.Now().UTC().Format(time.RFC3339)); err != nil {
					return err
				}
			}
			return nil
		})
	}
	return svc.SetAgentPresentationProfile(ctx, req)
}
