package runtimeagent

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalAppResourcePackApplySnapshotReadStaleReplaceAndClear(t *testing.T) {
	svc, accountID, localAgentRef := newLocalAppConfigureTestService(t)
	snapshotDecision, snapshotCtx := localAppConfigureContext(accountservice.LocalAppOperationPresentationSnapshot, 0x81, accountID)
	handle := mintLocalAppAgentHandle(snapshotDecision, localAgentRef)
	_, commitCtx := localAppConfigureContext(accountservice.LocalAppOperationCommitPresentation, 0x81, accountID)

	appearance, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: handle, ExpectedPresentationRevision: 0,
		Intent: &runtimev1.LocalAppAgentPresentationIntent{Patch: &runtimev1.AgentPresentationProfilePatch{
			BackendKind: runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM.Enum(),
		}},
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{testPresentationVRMMaterial()},
	})
	if err != nil {
		t.Fatalf("commit appearance baseline: %v", err)
	}
	avatarRef := appearance.GetProjection().GetProfile().GetAvatarAssetRef()
	if avatarRef == "" || appearance.GetProjection().GetPreviousProfile() != nil || appearance.GetProjection().GetPresentationRevision() != 1 {
		t.Fatalf("appearance baseline = %+v", appearance.GetProjection())
	}

	packA := testResourcePackMaterial(t, "pack-a", "[data-nimi-pack-zone=\"surface\"]{color:#123456}")
	appliedA, err := svc.CommitLocalAppAgentPresentation(commitCtx, resourcePackCommitRequest(handle, 1, packA))
	if err != nil {
		t.Fatalf("apply Resource Pack A: %v", err)
	}
	selectionA := appliedA.GetProjection().GetResourcePackSelection()
	if selectionA.GetAssetRef() == "" || selectionA.GetTargetId() != resourcePackTargetID || selectionA.GetTargetVersion() != resourcePackTargetVersion ||
		appliedA.GetProjection().GetPresentationRevision() != 2 || appliedA.GetProjection().GetProfile().GetAvatarAssetRef() != avatarRef ||
		appliedA.GetProjection().GetProfile().GetRevision() != 2 || appliedA.GetProjection().GetPreviousProfile() != nil {
		t.Fatalf("Pack A projection = %+v", appliedA.GetProjection())
	}

	snapshot, err := svc.GetLocalAppAgentPresentationSnapshot(snapshotCtx, &runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: handle})
	if err != nil || snapshot.GetProjection().GetResourcePackSelection().GetAssetRef() != selectionA.GetAssetRef() {
		t.Fatalf("snapshot after Pack A = (%+v, %v)", snapshot, err)
	}
	readA, err := svc.GetAgentPresentationAsset(snapshotCtx, &runtimev1.GetAgentPresentationAssetRequest{
		AgentHandle: handle, AssetRef: selectionA.GetAssetRef(),
	})
	if err != nil || readA.GetRole() != runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_RESOURCE_PACK ||
		readA.GetBackendKind() != runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED ||
		!bytes.Equal(readA.GetContent(), packA.GetContent()) {
		t.Fatalf("selected Pack A read = (%+v, %v)", readA, err)
	}

	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-configure-pack-foreign"),
	}); err != nil {
		t.Fatalf("materialize foreign Agent: %v", err)
	}
	foreignHandle := mintLocalAppAgentHandle(snapshotDecision, testRuntimeAgentLocalRef("agent-configure-pack-foreign"))
	if _, err := svc.GetAgentPresentationAsset(snapshotCtx, &runtimev1.GetAgentPresentationAssetRequest{
		AgentHandle: foreignHandle, AssetRef: selectionA.GetAssetRef(),
	}); status.Code(err) != codes.NotFound {
		t.Fatalf("cross-Agent Pack read code = %s, err=%v", status.Code(err), err)
	}

	packB := testResourcePackMaterial(t, "pack-b", "[data-nimi-pack-zone=\"surface\"]{color:#654321}")
	if _, err := svc.CommitLocalAppAgentPresentation(commitCtx, resourcePackCommitRequest(handle, 1, packB)); status.Code(err) != codes.Aborted {
		t.Fatalf("stale Pack replace code = %s, err=%v", status.Code(err), err)
	}
	afterStale, err := svc.GetLocalAppAgentPresentationSnapshot(snapshotCtx, &runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: handle})
	if err != nil || afterStale.GetProjection().GetPresentationRevision() != 2 ||
		afterStale.GetProjection().GetResourcePackSelection().GetAssetRef() != selectionA.GetAssetRef() {
		t.Fatalf("snapshot after stale Pack replace = (%+v, %v)", afterStale, err)
	}

	appliedB, err := svc.CommitLocalAppAgentPresentation(commitCtx, resourcePackCommitRequest(handle, 2, packB))
	if err != nil {
		t.Fatalf("replace with Resource Pack B: %v", err)
	}
	selectionB := appliedB.GetProjection().GetResourcePackSelection()
	if selectionB.GetAssetRef() == "" || selectionB.GetAssetRef() == selectionA.GetAssetRef() || appliedB.GetProjection().GetPresentationRevision() != 3 ||
		appliedB.GetProjection().GetProfile().GetAvatarAssetRef() != avatarRef || appliedB.GetProjection().GetPreviousProfile() != nil {
		t.Fatalf("Pack B projection = %+v", appliedB.GetProjection())
	}
	if record, exists, err := svc.presentationAssetByRef(context.Background(), localAgentRef, selectionA.GetAssetRef()); err != nil || exists || record != nil {
		t.Fatalf("replaced Pack A row = (%+v, %v, %v)", record, exists, err)
	}
	if _, err := svc.GetAgentPresentationAsset(snapshotCtx, &runtimev1.GetAgentPresentationAssetRequest{
		AgentHandle: handle, AssetRef: selectionA.GetAssetRef(),
	}); status.Code(err) != codes.NotFound {
		t.Fatalf("replaced Pack A read code = %s, err=%v", status.Code(err), err)
	}

	cleared, err := svc.CommitLocalAppAgentPresentation(commitCtx, &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: handle, ExpectedPresentationRevision: 3,
		Intent: &runtimev1.LocalAppAgentPresentationIntent{ClearResourcePackSelection: true},
	})
	if err != nil {
		t.Fatalf("clear Resource Pack selection: %v", err)
	}
	if cleared.GetProjection().GetPresentationRevision() != 4 || cleared.GetProjection().GetResourcePackSelection() != nil ||
		cleared.GetProjection().GetProfile().GetAvatarAssetRef() != avatarRef || cleared.GetProjection().GetProfile().GetRevision() != 4 ||
		cleared.GetProjection().GetPreviousProfile() != nil {
		t.Fatalf("cleared Pack projection = %+v", cleared.GetProjection())
	}
	if record, exists, err := svc.presentationAssetByRef(context.Background(), localAgentRef, selectionB.GetAssetRef()); err != nil || exists || record != nil {
		t.Fatalf("cleared Pack B row = (%+v, %v, %v)", record, exists, err)
	}
	if record, exists, err := svc.presentationAssetByRef(context.Background(), localAgentRef, avatarRef); err != nil || !exists || record == nil {
		t.Fatalf("Pack clear removed Avatar row = (%+v, %v, %v)", record, exists, err)
	}
}

func TestResourcePackStoreRecoveryRetainsSelectionAndRemovesOrphan(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, closeFirst := openRuntimeAgentTestComposition(t, localStatePath)
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-resource-pack-recovery"),
	}); err != nil {
		closeFirst()
		t.Fatalf("materialize recovery Agent: %v", err)
	}
	accountID := "user-1"
	localAgentRef := testRuntimeAgentLocalRef("agent-resource-pack-recovery")
	decision, commitCtx := localAppConfigureContext(accountservice.LocalAppOperationCommitPresentation, 0x91, accountID)
	handle := mintLocalAppAgentHandle(decision, localAgentRef)
	selectedMaterial := testResourcePackMaterial(t, "selected", "[data-nimi-pack-zone=\"surface\"]{color:#abcdef}")
	selected, err := svc.CommitLocalAppAgentPresentation(commitCtx, resourcePackCommitRequest(handle, 0, selectedMaterial))
	if err != nil {
		closeFirst()
		t.Fatalf("commit selected recovery Pack: %v", err)
	}
	selectedRef := selected.GetProjection().GetResourcePackSelection().GetAssetRef()

	orphanMaterial := testResourcePackMaterial(t, "orphan", "[data-nimi-pack-zone=\"surface\"]{color:#fedcba}")
	validated, err := validatePresentationAssetMaterials(localAgentRef, []*runtimev1.AgentPresentationAssetMaterial{orphanMaterial})
	if err != nil {
		closeFirst()
		t.Fatalf("validate orphan material: %v", err)
	}
	orphan := validated[runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_RESOURCE_PACK]
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_agent_presentation_asset(asset_ref, local_agent_ref, asset_role, backend_kind, file_name, media_type, sha256, byte_length, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			orphan.ref, localAgentRef, int32(orphan.role), int32(orphan.backendKind), orphan.fileName, orphan.mediaType,
			orphan.sha256, len(orphan.content), orphan.content, time.Now().UTC().Format(time.RFC3339))
		return err
	}); err != nil {
		closeFirst()
		t.Fatalf("insert orphan Pack row: %v", err)
	}
	closeFirst()

	reopened, closeSecond := openRuntimeAgentTestComposition(t, localStatePath)
	defer closeSecond()
	entry := reopened.agents[localAgentRef]
	if entry == nil || entry.Agent.GetResourcePackSelection().GetAssetRef() != selectedRef {
		t.Fatalf("reopened Resource Pack selection = %+v", entry)
	}
	if record, exists, err := reopened.presentationAssetByRef(context.Background(), localAgentRef, selectedRef); err != nil || !exists || record == nil {
		t.Fatalf("reopened selected Pack row = (%+v, %v, %v)", record, exists, err)
	}
	if record, exists, err := reopened.presentationAssetByRef(context.Background(), localAgentRef, orphan.ref); err != nil || exists || record != nil {
		t.Fatalf("reopened orphan Pack row = (%+v, %v, %v)", record, exists, err)
	}
}

func TestResourcePackValidationRejectsUnsupportedEnvelopeAndEntries(t *testing.T) {
	tests := []struct {
		name     string
		manifest map[string]any
		entries  map[string][]byte
	}{
		{
			name: "unknown executable field",
			manifest: map[string]any{
				"schemaVersion": 1, "target": map[string]any{"id": resourcePackTargetID, "version": 1},
				"styleEntry": "style.css", "resources": []string{}, "main": "main.js",
			},
		},
		{
			name: "wrong target",
			manifest: map[string]any{
				"schemaVersion": 1, "target": map[string]any{"id": "other-surface", "version": 1},
				"styleEntry": "style.css", "resources": []string{},
			},
		},
		{
			name:     "undeclared executable entry",
			manifest: testResourcePackManifest(nil),
			entries:  map[string][]byte{"main.js": []byte("alert(1)")},
		},
		{
			name:     "unsupported declared resource",
			manifest: testResourcePackManifest([]string{"assets/vector.svg"}),
			entries:  map[string][]byte{"assets/vector.svg": []byte("<svg/>")},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			content := buildTestResourcePack(t, testCase.manifest, "[data-nimi-pack-zone=\"surface\"]{}", testCase.entries)
			material := resourcePackMaterial("invalid", content)
			if _, err := validatePresentationAssetMaterials("local-agent:user-1:invalid", []*runtimev1.AgentPresentationAssetMaterial{material}); err == nil {
				t.Fatal("invalid Resource Pack validation succeeded")
			}
		})
	}
}

func TestResourcePackManifestParityUsesExactKeysAndJSNumberEquality(t *testing.T) {
	valid := []string{
		`{"schemaVersion":1,"target":{"id":"zhiyu-experience-surface","version":1},"styleEntry":"style.css","resources":[]}`,
		`{"resources":[],"styleEntry":"style.css","target":{"version":1e0,"id":"zhiyu-experience-surface"},"schemaVersion":1.0}`,
		`{"schemaVersion":0.99999999999999999,"target":{"id":"zhiyu-experience-surface","version":1.0000000000000001},"styleEntry":"style.css","resources":[]}`,
	}
	for index, manifest := range valid {
		if _, err := validatePresentationResourcePackArchive(buildTestResourcePackWithManifestBytes(
			t, []byte(manifest), `[data-nimi-pack-zone="surface"] { color: #102030; }`, nil,
		)); err != nil {
			t.Fatalf("valid JS-number manifest %d rejected: %v", index, err)
		}
	}

	invalid := []string{
		`{"SchemaVersion":1,"target":{"id":"zhiyu-experience-surface","version":1},"styleEntry":"style.css","resources":[]}`,
		`{"schemaVersion":1,"Target":{"id":"zhiyu-experience-surface","version":1},"styleEntry":"style.css","resources":[]}`,
		`{"schemaVersion":1,"target":{"ID":"zhiyu-experience-surface","version":1},"styleEntry":"style.css","resources":[]}`,
		`{"schemaVersion":1,"target":{"id":"zhiyu-experience-surface","Version":1},"styleEntry":"style.css","resources":[]}`,
		`{"schemaVersion":1.01,"target":{"id":"zhiyu-experience-surface","version":1},"styleEntry":"style.css","resources":[]}`,
		`{"schemaVersion":1,"target":{"id":"zhiyu-experience-surface","version":1.01},"styleEntry":"style.css","resources":[]}`,
		`{"schemaVersion":"1","target":{"id":"zhiyu-experience-surface","version":1},"styleEntry":"style.css","resources":[]}`,
	}
	for index, manifest := range invalid {
		if _, err := validatePresentationResourcePackArchive(buildTestResourcePackWithManifestBytes(
			t, []byte(manifest), `[data-nimi-pack-zone="surface"] { color: #102030; }`, nil,
		)); err == nil {
			t.Fatalf("invalid exact-key or numeric manifest %d succeeded", index)
		}
	}
}

func TestResourcePackStyleParityAcceptsTechnicalPackA(t *testing.T) {
	png := validResourcePackTestPNG(t)
	style := `
@container (max-width: 48rem) {
  [data-nimi-pack-zone="surface"] {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    padding: 24px;
    background-color: #182032;
    background-image: linear-gradient(#0008, #0008), url("assets/room.png");
    color: #f8fafc;
    font-family: "Curlz MT";
  }
}`
	content := buildTestResourcePack(t, testResourcePackManifest([]string{"assets/room.png"}), style, map[string][]byte{
		"assets/room.png": png,
	})
	if _, err := validatePresentationResourcePackArchive(content); err != nil {
		t.Fatalf("Technical Pack A style rejected: %v", err)
	}
}

func TestResourcePackStyleParityRejectsZhiyuDeniedShapes(t *testing.T) {
	png := validResourcePackTestPNG(t)
	tests := []struct {
		name      string
		style     string
		resources []string
		entries   map[string][]byte
	}{
		{name: "import", style: `@import url("https://example.com/theme.css");`},
		{name: "escaped identifier", style: `[data-nimi-pack-zone="surface"] { background-image: \75 \72 \6c ("https://example.com/x.png"); }`},
		{name: "descendant selector", style: `[data-nimi-pack-zone="surface"] button { color: red; }`},
		{name: "pseudo selector", style: `[data-nimi-pack-zone="surface"]::before { color: red; }`},
		{name: "foreign semantic selector", style: `[data-nimi-pack-zone="other"] { color: red; }`},
		{name: "position interception", style: `[data-nimi-pack-zone="surface"] { position: fixed; }`},
		{name: "pointer interception", style: `[data-nimi-pack-zone="surface"] { pointer-events: none; }`},
		{name: "hidden surface", style: `[data-nimi-pack-zone="surface"] { display: none; }`},
		{name: "empty value", style: `[data-nimi-pack-zone="surface"] { color: ; }`},
		{name: "remote URL", style: `[data-nimi-pack-zone="surface"] { background-image: url("https://example.com/x.png"); }`},
		{name: "data URL", style: `[data-nimi-pack-zone="surface"] { background-image: url("data:image/png;base64,AAAA"); }`},
		{name: "file URL", style: `[data-nimi-pack-zone="surface"] { background-image: url("file:///tmp/x.png"); }`},
		{name: "unquoted URL", style: `[data-nimi-pack-zone="surface"] { background-image: url(assets/room.png); }`, resources: []string{"assets/room.png"}, entries: map[string][]byte{"assets/room.png": png}},
		{name: "undeclared resource", style: `[data-nimi-pack-zone="surface"] { background-image: url("assets/missing.png"); }`},
		{name: "unused resource", style: `[data-nimi-pack-zone="surface"] { color: #fff; }`, resources: []string{"assets/unused.png"}, entries: map[string][]byte{"assets/unused.png": png}},
		{name: "unsupported at-rule", style: `@media (max-width: 600px) { [data-nimi-pack-zone="surface"] { color: red; } }`},
		{name: "unbounded container", style: `@container (min-width: 1601px) { [data-nimi-pack-zone="surface"] { color: red; } }`},
		{name: "automatic grid repetition", style: `[data-nimi-pack-zone="surface"] { grid-template-columns: repeat( auto-fit, minmax(0, 1fr)); }`},
		{name: "unsupported background function", style: `[data-nimi-pack-zone="surface"] { background-image: image-set(url("assets/room.png") 1x); }`, resources: []string{"assets/room.png"}, entries: map[string][]byte{"assets/room.png": png}},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			content := buildTestResourcePack(t, testResourcePackManifest(testCase.resources), testCase.style, testCase.entries)
			if _, err := validatePresentationResourcePackArchive(content); err == nil {
				t.Fatal("Zhiyu-denied Resource Pack style succeeded")
			}
		})
	}
}

func TestResourcePackRejectsAnimatedPNGAndWebP(t *testing.T) {
	animatedPNG := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0, 0, 0, 0, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 0,
	}
	animatedWebP := []byte{
		0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
		0x56, 0x50, 0x38, 0x58, 1, 0, 0, 0, 0x02, 0,
	}
	for _, resource := range []struct {
		path    string
		content []byte
	}{
		{path: "assets/animated.png", content: animatedPNG},
		{path: "assets/animated.webp", content: animatedWebP},
	} {
		content := buildTestResourcePack(
			t,
			testResourcePackManifest([]string{resource.path}),
			`[data-nimi-pack-zone="surface"] { background-image: url("`+resource.path+`"); }`,
			map[string][]byte{resource.path: resource.content},
		)
		if _, err := validatePresentationResourcePackArchive(content); err == nil {
			t.Fatalf("animated resource %s succeeded", resource.path)
		}
	}
}

func TestResourcePackRejectsSignatureOnlyAndOversizedImages(t *testing.T) {
	invalidPNG := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00}
	oversized := image.NewNRGBA(image.Rect(0, 0, 8193, 1))
	var oversizedPNG bytes.Buffer
	if err := png.Encode(&oversizedPNG, oversized); err != nil {
		t.Fatalf("encode oversized PNG: %v", err)
	}
	for name, resource := range map[string][]byte{
		"signature-only": invalidPNG,
		"oversized":      oversizedPNG.Bytes(),
	} {
		t.Run(name, func(t *testing.T) {
			content := buildTestResourcePack(
				t,
				testResourcePackManifest([]string{"assets/invalid.png"}),
				`[data-nimi-pack-zone="surface"] { background-image: url("assets/invalid.png"); }`,
				map[string][]byte{"assets/invalid.png": resource},
			)
			if _, err := validatePresentationResourcePackArchive(content); err == nil {
				t.Fatal("invalid Resource Pack image succeeded")
			}
		})
	}
}

func validResourcePackTestPNG(t *testing.T) []byte {
	t.Helper()
	value := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	value.SetNRGBA(0, 0, color.NRGBA{R: 0x18, G: 0x20, B: 0x32, A: 0xff})
	var output bytes.Buffer
	if err := png.Encode(&output, value); err != nil {
		t.Fatalf("encode test PNG: %v", err)
	}
	return output.Bytes()
}

func resourcePackCommitRequest(handle string, expectedRevision uint64, material *runtimev1.AgentPresentationAssetMaterial) *runtimev1.CommitLocalAppAgentPresentationRequest {
	return &runtimev1.CommitLocalAppAgentPresentationRequest{
		AgentHandle: handle, ExpectedPresentationRevision: expectedRevision,
		Intent:         &runtimev1.LocalAppAgentPresentationIntent{SelectImportedResourcePack: true},
		ImportedAssets: []*runtimev1.AgentPresentationAssetMaterial{material},
	}
}

func testResourcePackMaterial(t *testing.T, name, style string) *runtimev1.AgentPresentationAssetMaterial {
	t.Helper()
	return resourcePackMaterial(name, buildTestResourcePack(t, testResourcePackManifest(nil), style, nil))
}

func resourcePackMaterial(name string, content []byte) *runtimev1.AgentPresentationAssetMaterial {
	digest := sha256.Sum256(content)
	return &runtimev1.AgentPresentationAssetMaterial{
		Role:     runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_RESOURCE_PACK,
		FileName: name + ".nimipack", MediaType: resourcePackMediaType,
		Content: content, Sha256: hex.EncodeToString(digest[:]),
	}
}

func testResourcePackManifest(resources []string) map[string]any {
	if resources == nil {
		resources = []string{}
	}
	return map[string]any{
		"schemaVersion": 1,
		"target":        map[string]any{"id": resourcePackTargetID, "version": 1},
		"styleEntry":    "style.css",
		"resources":     resources,
	}
}

func buildTestResourcePack(t *testing.T, manifest map[string]any, style string, extra map[string][]byte) []byte {
	t.Helper()
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal test Resource Pack manifest: %v", err)
	}
	return buildTestResourcePackWithManifestBytes(t, manifestBytes, style, extra)
}

func buildTestResourcePackWithManifestBytes(t *testing.T, manifestBytes []byte, style string, extra map[string][]byte) []byte {
	t.Helper()
	entries := map[string][]byte{resourcePackManifestPath: manifestBytes, "style.css": []byte(style)}
	for name, content := range extra {
		entries[name] = content
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range []string{resourcePackManifestPath, "style.css"} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create test Resource Pack entry: %v", err)
		}
		if _, err := entry.Write(entries[name]); err != nil {
			t.Fatalf("write test Resource Pack entry: %v", err)
		}
		delete(entries, name)
	}
	for name, content := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create test Resource Pack extra entry: %v", err)
		}
		if _, err := entry.Write(content); err != nil {
			t.Fatalf("write test Resource Pack extra entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close test Resource Pack: %v", err)
	}
	return buffer.Bytes()
}
