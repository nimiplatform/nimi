package apppermission

import "testing"

func TestPublicPermissionCatalogIsClosedAndReservedUntilCompleteAdmission(t *testing.T) {
	known := []string{
		"agents.interact", "artifacts.open", "account.profile.read", "memory.read",
		"memory.write", "knowledge.read", "knowledge.write", "notifications.send",
		"notifications.receive", "files.open", "files.save", "realm.library.read",
		"realm.library.manage", "realm.publish", "ai.background", "shared_resources.open",
	}
	for _, id := range known {
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

func TestProtectedOperationsMapToProductPermissionsWithoutAdmittingThem(t *testing.T) {
	operations := map[string]string{
		"artifacts.read_runtime_bytes":              "artifacts.open",
		"runtime_agent.conversation.open":           "agents.interact",
		"runtime_agent.conversation.turn_send":      "agents.interact",
		"runtime_agent.conversation.turn_subscribe": "agents.interact",
		"runtime_agent.conversation.snapshot":       "agents.interact",
		"runtime_agent.voice.transcribe":            "agents.interact",
		"runtime_agent.voice.stream_subscribe":      "agents.interact",
	}
	for operationID, permissionID := range operations {
		descriptor, ok := ForOperation(operationID)
		if !ok || descriptor.ID != permissionID || descriptor.Admission != AdmissionReserved {
			t.Fatalf("operation %q mapping = %+v, known=%v", operationID, descriptor, ok)
		}
	}
	if _, ok := ForOperation("app_storage.json.write"); ok {
		t.Fatal("app-private storage must not map to a user permission")
	}
}
