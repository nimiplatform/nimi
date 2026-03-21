package grpcserver

import "testing"

func TestProtectedCapabilityForStream(t *testing.T) {
	capability, required := protectedCapabilityForStream("/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents")
	if !required {
		t.Fatal("expected audit export stream to require authz")
	}
	if capability != "runtime.audit.export" {
		t.Fatalf("capability mismatch: %q", capability)
	}

	capability, required = protectedCapabilityForStream("/nimi.runtime.v1.RuntimeAiService/StreamScenarioEvents")
	if required || capability != "" {
		t.Fatalf("expected unrelated stream to be unprotected, got (%q,%v)", capability, required)
	}
}
