package apppermission

import (
	"os"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestPublicPermissionCatalogIsClosedWithOnlyAgentsInteractAdmitted(t *testing.T) {
	descriptor, ok := Lookup("agents.interact")
	if !ok || descriptor.Admission != AdmissionAdmitted || !descriptor.ManifestAllowed || !IsAdmitted("agents.interact") {
		t.Fatalf("agents.interact publication = %+v, known=%v", descriptor, ok)
	}
	reserved := []string{
		"agents.configure", "agents.voice", "agents.delegate",
		"artifacts.open", "account.profile.read", "memory.read", "memory.write",
		"knowledge.read", "knowledge.write", "notifications.send", "notifications.receive",
		"files.open", "files.save", "realm.library.read", "realm.library.manage",
		"realm.publish", "ai.background", "shared_resources.open",
	}
	for _, id := range reserved {
		descriptor, ok := Lookup(id)
		if !ok || descriptor.ID != id || descriptor.Admission != AdmissionReserved || IsAdmitted(id) {
			t.Fatalf("permission %q has unexpected descriptor: %+v, known=%v", id, descriptor, ok)
		}
	}
	for _, id := range []string{"", "runtime_agent.conversation.open", "file.read.scoped", "agents.interact "} {
		if _, ok := Lookup(id); ok || IsAdmitted(id) {
			t.Fatalf("unknown/internal permission %q entered the public catalog", id)
		}
	}
}

func TestProtectedOperationsMapToTheirPublishedProductPermission(t *testing.T) {
	operations := map[string]string{
		"artifacts.read_runtime_bytes":              "artifacts.open",
		"runtime_agent.conversation.open":           "agents.interact",
		"runtime_agent.conversation.turn_send":      "agents.interact",
		"runtime_agent.conversation.turn_subscribe": "agents.interact",
		"runtime_agent.conversation.snapshot":       "agents.interact",
		"runtime_agent.configuration.snapshot":      "agents.configure",
		"runtime_agent.configuration.update":        "agents.configure",
		"runtime_agent.readiness.snapshot":          "agents.configure",
		"runtime_agent.autonomy.snapshot":           "agents.configure",
		"runtime_agent.autonomy.update":             "agents.configure",
		"runtime_agent.presentation.snapshot":       "agents.configure",
		"runtime_agent.presentation.commit":         "agents.configure",
	}
	for operationID, permissionID := range operations {
		descriptor, ok := ForOperation(operationID)
		expectedAdmission := AdmissionReserved
		if permissionID == "agents.interact" {
			expectedAdmission = AdmissionAdmitted
		}
		if !ok || descriptor.ID != permissionID || descriptor.Admission != expectedAdmission {
			t.Fatalf("operation %q mapping = %+v, known=%v", operationID, descriptor, ok)
		}
	}
	for _, operationID := range []string{"app_storage.json.write", "runtime_agent.voice.transcribe", "runtime_agent.voice.stream_subscribe"} {
		if _, ok := ForOperation(operationID); ok {
			t.Fatalf("operation %q must remain typed-unavailable without a user permission mapping", operationID)
		}
	}
}

type permissionCatalogFile struct {
	PublicPermissions []struct {
		PermissionID              string   `yaml:"permission_id"`
		Admission                 string   `yaml:"admission"`
		ManifestAllowed           bool     `yaml:"manifest_allowed"`
		InternalOperationFamilies []string `yaml:"internal_operation_families"`
	} `yaml:"public_permissions"`
}

func TestRuntimeCatalogMatchesPublishedProductCatalog(t *testing.T) {
	path := filepath.Clean(filepath.Join("..", "..", "..", "config", "platform-nimi-app-permission-catalog.yaml"))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var source permissionCatalogFile
	if err := yaml.Unmarshal(raw, &source); err != nil {
		t.Fatal(err)
	}
	if len(source.PublicPermissions) != len(catalog) {
		t.Fatalf("catalog size drift: Runtime=%d config=%d", len(catalog), len(source.PublicPermissions))
	}
	seen := make(map[string]struct{}, len(source.PublicPermissions))
	for _, row := range source.PublicPermissions {
		if _, duplicate := seen[row.PermissionID]; duplicate {
			t.Fatalf("duplicate config catalog row %q", row.PermissionID)
		}
		seen[row.PermissionID] = struct{}{}
		descriptor, ok := Lookup(row.PermissionID)
		if !ok || descriptor.ManifestAllowed != row.ManifestAllowed {
			t.Fatalf("catalog row drift for %q: Runtime=%+v config manifest_allowed=%v", row.PermissionID, descriptor, row.ManifestAllowed)
		}
		if descriptor.Admission != Admission(row.Admission) {
			t.Fatalf("admission drift for %q: Runtime=%s config=%s", row.PermissionID, descriptor.Admission, row.Admission)
		}
		if row.PermissionID == "agents.configure" && descriptor.Admission != AdmissionReserved {
			t.Fatalf("agents.configure admission drift: %s", descriptor.Admission)
		}
	}
}
