package ai

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/protobuf/encoding/protojson"
)

// The durable audit plane keeps the exact request identity of a Cloud text
// execution, never its prompt content.
func TestCloudTextCaptureRecordsRequestDigestWithoutPromptContent(t *testing.T) {
	store := auditlog.New(16, 16)
	service := &Service{audit: store}
	effective := &cloudTextEffectiveInputs{
		implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.test", DriverId: "driver.test", DriverDialect: "dialect.test"},
		request: &runtimev1.TextGenerateScenarioSpec{
			SystemPrompt: "private system instructions",
			Input:        []*runtimev1.ChatMessage{{Role: "user", Content: "my private diary entry"}},
		},
		appID: "app.test", accountID: "account-1", traceID: "trace-1",
	}
	if err := service.auditCloudTextCapture(effective, false); err != nil {
		t.Fatalf("audit capture: %v", err)
	}
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.ai"})
	if err != nil || len(response.GetEvents()) != 1 {
		t.Fatalf("capture records = %v err=%v", response, err)
	}
	fields := response.GetEvents()[0].GetPayload().GetFields()
	if !strings.HasPrefix(fields["request_sha256"].GetStringValue(), "sha256:") || fields["request_size_bytes"].GetNumberValue() <= 0 || fields["request"] != nil {
		t.Fatalf("capture payload = %v", fields)
	}
	encoded, err := protojson.Marshal(response.GetEvents()[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private system instructions", "my private diary entry"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("capture record carries prompt content %q", private)
		}
	}
}
