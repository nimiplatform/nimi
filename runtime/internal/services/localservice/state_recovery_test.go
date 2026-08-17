package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalStateRecordIsolationCoversSupportedSections(t *testing.T) {
	valid := map[string]map[string]any{
		"transfers":                               {"installSessionId": "transfer-ok"},
		"audits":                                  {"id": "audit-ok"},
		"localEnvironmentHostProfiles":            {"hostProfileId": "host-ok"},
		"localEnvironmentSelectedSourceRecords":   {"recordId": "source-ok", "environmentKey": "env-ok", "dependencyFamily": localEnvironmentFamilyNativeLlama, "dependencyId": "llama.cpp.package"},
		"localEnvironmentDependencyJobs":          {"jobId": "job-ok", "dependencyFamily": localEnvironmentFamilyNativeLlama},
		"localEnvironmentPlanDependencyContracts": {"environmentKey": "env-ok", "dependencyFamily": localEnvironmentFamilyNativeLlama, "dependencyId": "llama.cpp.package", "consumerScope": "llama.cpp.cpu"},
	}
	document := map[string]any{"schemaVersion": localStateSchemaVersion}
	for section, row := range valid {
		invalid := make(map[string]any, len(row)+1)
		for key, value := range row {
			invalid[key] = value
		}
		invalid["unknownSchemaFragment"] = true
		document[section] = []any{row, invalid}
	}
	payload, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal state fixture: %v", err)
	}
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	if err := os.WriteFile(statePath, payload, 0o600); err != nil {
		t.Fatalf("write state fixture: %v", err)
	}

	snapshot, diagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(statePath)
	if err != nil {
		t.Fatalf("load isolated state: %v", err)
	}
	counts := []int{
		len(snapshot.Transfers), len(snapshot.Audits),
		len(snapshot.LocalEnvironmentHostProfiles), len(snapshot.LocalEnvironmentSelectedSources),
		len(snapshot.LocalEnvironmentDependencyJobs), len(snapshot.LocalEnvironmentPlanContracts),
	}
	for index, count := range counts {
		if count != 1 {
			t.Fatalf("section %d healthy sibling count=%d, want 1", index, count)
		}
	}
	if len(diagnostics) != len(valid) || !rewriteRequired {
		t.Fatalf("diagnostics=%d rewrite=%t, want %d/true", len(diagnostics), rewriteRequired, len(valid))
	}
	for _, diagnostic := range diagnostics {
		if diagnostic.Level != stateIsolationLevelRecord || diagnostic.ReasonCode != localStateRecordQuarantinedReason {
			t.Fatalf("unexpected diagnostic: %+v", diagnostic)
		}
		if _, err := os.Stat(diagnostic.QuarantinePath); err != nil {
			t.Fatalf("record quarantine missing: %v", err)
		}
	}
}

func TestLocalStateRecordIsolationRejectsRetiredModelEnvironmentFamilies(t *testing.T) {
	document := map[string]any{
		"schemaVersion": localStateSchemaVersion,
		"localEnvironmentSelectedSourceRecords": []any{map[string]any{
			"recordId": "source-model", "environmentKey": "env-model", "dependencyFamily": "model.asset", "dependencyId": "model-1",
		}},
		"localEnvironmentDependencyJobs": []any{map[string]any{
			"jobId": "job-model", "dependencyFamily": "model.companion-asset",
		}},
		"localEnvironmentPlanDependencyContracts": []any{map[string]any{
			"environmentKey": "env-model", "dependencyFamily": "model.asset", "dependencyId": "model-1", "consumerScope": "llama.cpp.cpu",
		}},
	}
	payload, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal retired family state: %v", err)
	}
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	if err := os.WriteFile(statePath, payload, 0o600); err != nil {
		t.Fatalf("write retired family state: %v", err)
	}

	snapshot, diagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(statePath)
	if err != nil {
		t.Fatalf("load retired family state: %v", err)
	}
	if len(snapshot.LocalEnvironmentSelectedSources) != 0 || len(snapshot.LocalEnvironmentDependencyJobs) != 0 || len(snapshot.LocalEnvironmentPlanContracts) != 0 {
		t.Fatalf("retired model environment state remained active: sources=%d jobs=%d contracts=%d", len(snapshot.LocalEnvironmentSelectedSources), len(snapshot.LocalEnvironmentDependencyJobs), len(snapshot.LocalEnvironmentPlanContracts))
	}
	if len(diagnostics) != 3 || !rewriteRequired {
		t.Fatalf("retired family diagnostics=%d rewrite=%t, want 3/true", len(diagnostics), rewriteRequired)
	}
}

func TestInstallModelFromPlanUsesSingleUseOwnerScopedServerPlan(t *testing.T) {
	svc := newTestService(t)
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId: "catalog.server-held", Source: "verified", ModelId: "local/server-held", Repo: "owner/repo",
		Revision: "main", Capabilities: []string{"text.generate"},
	})
	svc.mu.Unlock()
	ownerA := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "owner-a", SessionID: "session-a"})
	ownerB := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "owner-b", SessionID: "session-b"})
	resolved, err := svc.ResolveModelInstallPlan(ownerA, &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.server-held",
	})
	if err != nil {
		t.Fatalf("resolve plan: %v", err)
	}
	planID := resolved.GetPlan().GetPlanId()
	before := len(svc.modelAssets)
	if _, err := svc.InstallModelFromPlan(ownerB, &runtimev1.InstallModelFromPlanRequest{PlanId: planID}); err == nil {
		t.Fatal("cross-owner plan use succeeded")
	}
	if len(svc.modelAssets) != before {
		t.Fatal("cross-owner rejection wrote inventory")
	}

	installed, err := svc.InstallModelFromPlan(ownerA, &runtimev1.InstallModelFromPlanRequest{PlanId: planID})
	if status.Code(err) != codes.FailedPrecondition || installed != nil {
		t.Fatalf("server-held unavailable plan result=%+v err=%v", installed, err)
	}
	afterAttempt := len(svc.modelAssets)
	if _, err := svc.InstallModelFromPlan(ownerA, &runtimev1.InstallModelFromPlanRequest{PlanId: planID}); err == nil {
		t.Fatal("consumed plan was reusable")
	}
	if _, err := svc.InstallModelFromPlan(ownerA, &runtimev1.InstallModelFromPlanRequest{PlanId: "plan_forged"}); err == nil {
		t.Fatal("forged plan id succeeded")
	}
	if _, err := svc.InstallModelFromPlan(ownerA, &runtimev1.InstallModelFromPlanRequest{}); err == nil {
		t.Fatal("missing plan id succeeded")
	}
	if len(svc.modelAssets) != afterAttempt {
		t.Fatal("missing, forged, or reused plan id mutated inventory")
	}
}

func TestInstallModelFromPlanRejectsExpiredPlanWithoutWrites(t *testing.T) {
	svc := newTestService(t)
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId: "catalog.expired", Source: "verified", ModelId: "local/expired", Repo: "owner/repo",
		Revision: "main", Capabilities: []string{"text.generate"},
	})
	svc.mu.Unlock()
	now := time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC)
	svc.modelInstallPlanNow = func() time.Time { return now }
	resolved, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.expired",
	})
	if err != nil {
		t.Fatalf("resolve plan: %v", err)
	}
	now = now.Add(modelInstallPlanTTL + time.Second)
	before := len(svc.modelAssets)
	_, err = svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{PlanId: resolved.GetPlan().GetPlanId()})
	if err == nil {
		t.Fatal("expired plan succeeded")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expired plan was not typed: reason=%v ok=%t err=%v", reason, ok, err)
	}
	if len(svc.modelAssets) != before {
		t.Fatal("expired plan rejection wrote inventory")
	}
}

func TestResolvedManifestRecoveryReportIsReadOnlyAndRehashesPayload(t *testing.T) {
	root := t.TempDir()
	resolvedRoot := filepath.Join(root, "resolved")
	goodDir := filepath.Join(resolvedRoot, "good")
	badDir := filepath.Join(resolvedRoot, "bad")
	if err := os.MkdirAll(goodDir, 0o755); err != nil {
		t.Fatalf("create good dir: %v", err)
	}
	if err := os.MkdirAll(badDir, 0o755); err != nil {
		t.Fatalf("create bad dir: %v", err)
	}
	payloadPath := filepath.Join(goodDir, "model.gguf")
	if err := os.WriteFile(payloadPath, []byte("GGUF-recovery-payload"), 0o600); err != nil {
		t.Fatalf("write payload: %v", err)
	}
	if err := os.WriteFile(filepath.Join(goodDir, "asset.manifest.json"), []byte(`{"entry":"model.gguf","files":["model.gguf"]}`), 0o600); err != nil {
		t.Fatalf("write good manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(badDir, "asset.manifest.json"), []byte(`{"entry":`), 0o600); err != nil {
		t.Fatalf("write bad manifest: %v", err)
	}
	payloadSHA256, err := computeImportFileSHA256(payloadPath)
	if err != nil {
		t.Fatalf("hash catalog fixture: %v", err)
	}
	verified := []*runtimev1.LocalVerifiedAssetDescriptor{{Files: []string{"model.gguf"}, Hashes: map[string]string{"model.gguf": payloadSHA256}}}
	before := treeSnapshotForRecoveryTest(t, resolvedRoot)
	items := scanResolvedManifestDirectories(root, verified, nil)
	after := treeSnapshotForRecoveryTest(t, resolvedRoot)
	if strings.Join(before, "\n") != strings.Join(after, "\n") {
		t.Fatalf("report mode mutated files: before=%v after=%v", before, after)
	}
	if len(items) != 2 {
		t.Fatalf("report items=%d want 2: %+v", len(items), items)
	}
	byName := map[string]*ResolvedManifestDirectoryReport{}
	for _, item := range items {
		byName[item.GetFilename()] = item
	}
	good := byName["good"]
	bad := byName["bad"]
	if good.GetRecoveryStatus() != "reimportable" || good.GetContentId() == "" || good.GetUnclassified() || !good.GetCatalogHit() {
		t.Fatalf("good report=%+v", good)
	}
	if bad.GetRecoveryStatus() != "failed" || bad.GetFailureReason() == "" {
		t.Fatalf("bad report=%+v", bad)
	}
	registered := map[string]struct{}{canonicalReportPath(goodDir): {}}
	if filtered := scanResolvedManifestDirectories(root, nil, registered); len(filtered) != 1 || filtered[0].GetFilename() != "bad" {
		t.Fatalf("registered directory was not skipped: %+v", filtered)
	}
}

func TestCanonicalReportPathFoldsCaseOnlyOnWindows(t *testing.T) {
	upper := filepath.Join(t.TempDir(), "Resolved", "Model")
	lower := strings.ToLower(upper)
	if canonicalReportPathForOS(upper, "windows") != canonicalReportPathForOS(lower, "windows") {
		t.Fatal("Windows report paths must compare case-insensitively")
	}
	for _, goos := range []string{"linux", "darwin"} {
		if canonicalReportPathForOS(upper, goos) == canonicalReportPathForOS(lower, goos) {
			t.Fatalf("%s report paths unexpectedly folded case", goos)
		}
	}
}

func treeSnapshotForRecoveryTest(t *testing.T, root string) []string {
	t.Helper()
	items := make([]string, 0)
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		payload, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, _ := filepath.Rel(root, path)
		items = append(items, filepath.ToSlash(relative)+":"+string(payload))
		return nil
	}); err != nil {
		t.Fatalf("snapshot tree: %v", err)
	}
	return items
}
