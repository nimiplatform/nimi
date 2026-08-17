package localservice

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/types/known/structpb"
)

func newLoadoutTestService(t *testing.T, root string) *Service {
	t.Helper()
	service := newLoadoutTestServiceWithoutCleanup(t, root)
	t.Cleanup(service.Close)
	return service
}

func newLoadoutTestServiceWithoutCleanup(t *testing.T, root string) *Service {
	t.Helper()
	service, err := New(nil, nil, filepath.Join(root, "local-state.json"), 0, filepath.Join(root, "models"))
	if err != nil {
		t.Fatalf("New local service: %v", err)
	}
	return service
}

func mustStructForTest(t *testing.T, fields map[string]any) *structpb.Struct {
	t.Helper()
	value, err := structpb.NewStruct(fields)
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}
	return value
}

func verifiedSelectedSourceRecordForTest(record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	if record.SourceKind == "" {
		record.SourceKind = localEnvironmentSourceManaged
	}
	if record.CanonicalRoot == "" {
		record.CanonicalRoot = "test-canonical-root"
	}
	if record.Version == "" && len(record.Hashes) == 0 {
		record.Version = "test-version"
	}
	if len(record.CompatibilityEvidence) == 0 {
		record.CompatibilityEvidence = []string{"test compatibility evidence"}
	}
	if len(record.VerifiedArtifacts) == 0 {
		record.VerifiedArtifacts = []string{"test-artifact"}
	}
	if len(record.SelectedConsumers) == 0 {
		record.SelectedConsumers = []string{"test-consumer"}
	}
	if record.SourceManifestRef == "" {
		record.SourceManifestRef = "test-source-manifest#" + shortHash(record.EnvironmentKey)
	}
	if record.VerificationEvidenceRef == "" {
		record.VerificationEvidenceRef = "test-verification-evidence#" + shortHash(record.EnvironmentKey)
	}
	if record.AuditReasonCode == "" {
		record.AuditReasonCode = "test_ready"
	}
	return record
}

func writeSelectedSourceLocalArtifactsForTest(t *testing.T, record localEnvironmentSelectedSourceRecordState) {
	t.Helper()
	for _, check := range localEnvironmentSelectedSourceLocalArtifactChecks(record) {
		if check.Path == "" {
			continue
		}
		if check.RequireDirectory {
			if err := os.MkdirAll(check.Path, 0o755); err != nil {
				t.Fatalf("mkdir selected source artifact dir %q: %v", check.Path, err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(check.Path), 0o755); err != nil {
			t.Fatalf("mkdir selected source artifact parent %q: %v", check.Path, err)
		}
		if err := os.WriteFile(check.Path, []byte("test artifact"), 0o644); err != nil {
			t.Fatalf("write selected source artifact %q: %v", check.Path, err)
		}
	}
}

func writePythonDependencyProfileStaticFilesForTest(
	t *testing.T,
	root string,
	consumer string,
	identity engine.PythonDependencyProfileIdentity,
) {
	t.Helper()
	files, err := engine.PythonDependencyProfileStaticFiles(consumer, identity)
	if err != nil {
		t.Fatalf("resolve canonical dependency-profile static files: %v", err)
	}
	for _, file := range files {
		path := filepath.Join(root, file.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("create dependency-profile static file parent: %v", err)
		}
		if err := os.Chmod(path, 0o600); err != nil && !os.IsNotExist(err) {
			t.Fatalf("make dependency-profile static file writable: %v", err)
		}
		if err := os.WriteFile(path, file.Content, 0o444); err != nil {
			t.Fatalf("write dependency-profile static file: %v", err)
		}
		if err := os.Chmod(path, 0o444); err != nil {
			t.Fatalf("restore dependency-profile static file read-only mode: %v", err)
		}
	}
}
