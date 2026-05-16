package runtimeagent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalAvatarPackageProjectionResolverResolvesImportedMaterialization(t *testing.T) {
	root := t.TempDir()
	req := AvatarPackageLaunchProjectionRequest{
		CallerAppID:      "nimi.avatar",
		SubjectUserID:    "owner-1",
		OwnerUserID:      "owner-1",
		RealmAgentID:     "agent-1",
		LocalAgentRef:    "local-agent:owner-1:agent-1",
		AvatarInstanceID: "avatar-1",
	}
	packageID := "live2d_abcdef123456"
	writeLocalAvatarPackageFixture(t, root, req, packageID)

	resolver := NewLocalAvatarPackageProjectionResolver(root)
	projection, err := resolver.ResolveAvatarPackageLaunchProjection(context.Background(), req)
	if err != nil {
		t.Fatalf("ResolveAvatarPackageLaunchProjection: %v", err)
	}
	if projection.GetAvatarPackageRef() != packageID {
		t.Fatalf("avatar package ref mismatch: %q", projection.GetAvatarPackageRef())
	}
	if projection.GetPackageKind() != "avatar" || projection.GetBackendKind() != "live2d" {
		t.Fatalf("unexpected projection kind/backend: %s %s", projection.GetPackageKind(), projection.GetBackendKind())
	}
	if projection.GetProvenance().GetSourceType() != "imported_local_materialization" {
		t.Fatalf("unexpected provenance source: %q", projection.GetProvenance().GetSourceType())
	}
	expectedRef := localAvatarPackageMaterializationRef(req.OwnerUserID, req.LocalAgentRef, "live2d", packageID)
	if projection.GetMaterializationRef() != expectedRef {
		t.Fatalf("materialization ref mismatch: got=%q want=%q", projection.GetMaterializationRef(), expectedRef)
	}
	if err := validateRuntimeAvatarPackageLaunchProjection(projection); err != nil {
		t.Fatalf("projection failed service validation: %v", err)
	}
}

func TestLocalAvatarPackageProjectionResolverFailsClosedWithoutConfig(t *testing.T) {
	resolver := NewLocalAvatarPackageProjectionResolver(t.TempDir())
	_, err := resolver.ResolveAvatarPackageLaunchProjection(context.Background(), AvatarPackageLaunchProjectionRequest{
		CallerAppID:      "nimi.avatar",
		SubjectUserID:    "owner-1",
		OwnerUserID:      "owner-1",
		RealmAgentID:     "agent-1",
		LocalAgentRef:    "local-agent:owner-1:agent-1",
		AvatarInstanceID: "avatar-1",
	})
	if err == nil {
		t.Fatal("expected missing config to fail closed")
	}
}

func writeLocalAvatarPackageFixture(t *testing.T, root string, req AvatarPackageLaunchProjectionRequest, packageID string) {
	t.Helper()
	scopeDir := filepath.Join(
		root,
		"accounts",
		agentCenterPathSegment(req.OwnerUserID),
		"agents",
		agentCenterPathSegment(req.LocalAgentRef),
		"agent-center",
	)
	config := map[string]any{
		"schema_version":  1,
		"config_kind":     "agent_center_local_config",
		"account_id":      req.OwnerUserID,
		"owner_user_id":   req.OwnerUserID,
		"realm_agent_id":  req.RealmAgentID,
		"local_agent_ref": req.LocalAgentRef,
		"modules": map[string]any{
			"avatar_package": map[string]any{
				"schema_version":                 1,
				"avatar_package_ref":             packageID,
				"backend_kind":                   "live2d",
				"backend_capability_profile_ref": "profile_live2d_default",
				"updated_at":                     "2026-05-16T00:00:00.000Z",
				"provenance": map[string]any{
					"source":       "import_validation",
					"evidence_ref": "test",
				},
			},
		},
	}
	writeJSON(t, filepath.Join(scopeDir, "config.json"), config)

	packageDir := filepath.Join(scopeDir, "modules", "avatar_package", "packages", "live2d", packageID)
	if err := os.MkdirAll(filepath.Join(packageDir, "files", "nimi"), 0o755); err != nil {
		t.Fatalf("mkdir package: %v", err)
	}
	entryPath := filepath.Join(packageDir, "files", "ren.model3.json")
	if err := os.WriteFile(entryPath, []byte(`{"Version":3}`), 0o644); err != nil {
		t.Fatalf("write model: %v", err)
	}
	adapterPath := filepath.Join(packageDir, "files", "nimi", "live2d-adapter.json")
	if err := os.WriteFile(adapterPath, []byte(`{"schema_version":1}`), 0o644); err != nil {
		t.Fatalf("write adapter: %v", err)
	}
	manifest := map[string]any{
		"manifest_version": 1,
		"package_version":  "1.0.0",
		"package_id":       packageID,
		"kind":             "live2d",
		"entry_file":       "files/ren.model3.json",
		"required_files": []string{
			"files/ren.model3.json",
			"files/nimi/live2d-adapter.json",
		},
		"content_digest": "sha256:test",
		"files": []map[string]any{{
			"path":   "files/ren.model3.json",
			"sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"bytes":  13,
			"mime":   "application/json",
		}, {
			"path":   "files/nimi/live2d-adapter.json",
			"sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			"bytes":  20,
			"mime":   "application/json",
		}},
		"limits": map[string]any{},
		"import": map[string]any{
			"imported_at":        "2026-05-16T00:00:00.000Z",
			"source_label":       "test",
			"source_fingerprint": "sha256:test",
		},
	}
	writeJSON(t, filepath.Join(packageDir, "manifest.json"), manifest)
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
