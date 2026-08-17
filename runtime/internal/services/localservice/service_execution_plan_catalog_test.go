package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestLocalAuditFilterByTargetID(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.AppendInferenceAudit(context.Background(), &runtimev1.AppendInferenceAuditRequest{
		EventType:  "inference_invoked",
		TargetId:   "world.nimi.user-math-quiz",
		Source:     "local",
		Provider:   "llama",
		Modality:   "chat",
		Adapter:    "openai_compat_adapter",
		Model:      "local/chat-default",
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED.String(),
	}); err != nil {
		t.Fatalf("append inference audit: %v", err)
	}

	if _, err := svc.AppendRuntimeAudit(context.Background(), &runtimev1.AppendRuntimeAuditRequest{
		EventType: "runtime_model_ready_after_install",
		ModelId:   "local/chat-default",
		Payload:   localAuditReasonPayload(runtimev1.ReasonCode_ACTION_EXECUTED),
	}); err != nil {
		t.Fatalf("append runtime audit: %v", err)
	}

	filtered, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		TargetId: "world.nimi.user-math-quiz",
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("list local audits by target id: %v", err)
	}
	if len(filtered.GetEvents()) != 1 {
		t.Fatalf("filtered events mismatch: got=%d want=1", len(filtered.GetEvents()))
	}
	if filtered.GetEvents()[0].GetEventType() != "inference_invoked" {
		t.Fatalf("unexpected filtered event type: %s", filtered.GetEvents()[0].GetEventType())
	}
}

func TestLocalAuditContextEnvelopeAndFilters(t *testing.T) {
	svc := newTestService(t)

	ctx := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "subject-ctx"})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-trace-id", "trace-local-audit-ctx",
		"x-nimi-app-id", "app.ctx",
		"x-nimi-domain", "runtime.local_runtime",
	))

	if _, err := svc.AppendInferenceAudit(ctx, &runtimev1.AppendInferenceAuditRequest{
		EventType:  "ctx_audit",
		Source:     "local",
		Model:      "local/ctx-model",
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED.String(),
	}); err != nil {
		t.Fatalf("append inference audit: %v", err)
	}

	filtered, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		EventType:     "ctx_audit",
		AppId:         "app.ctx",
		SubjectUserId: "subject-ctx",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("list local audits with app/subject filter: %v", err)
	}
	if len(filtered.GetEvents()) != 1 {
		t.Fatalf("expected exactly one filtered event, got %d", len(filtered.GetEvents()))
	}
	event := filtered.GetEvents()[0]
	if event.GetTraceId() != "trace-local-audit-ctx" {
		t.Fatalf("unexpected trace_id: %s", event.GetTraceId())
	}
	if event.GetAppId() != "app.ctx" {
		t.Fatalf("unexpected app_id: %s", event.GetAppId())
	}
	if event.GetDomain() != "runtime.local_runtime" {
		t.Fatalf("unexpected domain: %s", event.GetDomain())
	}
	if event.GetOperation() != "append_inference_audit" {
		t.Fatalf("unexpected operation: %s", event.GetOperation())
	}
	if event.GetSubjectUserId() != "subject-ctx" {
		t.Fatalf("unexpected subject_user_id: %s", event.GetSubjectUserId())
	}
}

func localAuditReasonPayload(reason runtimev1.ReasonCode) *structpb.Struct {
	payload, _ := structpb.NewStruct(map[string]any{"reason_code": reason.String()})
	return payload
}

func TestLocalCollectDeviceProfileUsesRealProbe(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
	if err != nil {
		t.Fatalf("collect device profile: %v", err)
	}
	profile := resp.GetProfile()
	if profile.GetOs() == "" || profile.GetArch() == "" {
		t.Fatalf("device profile must include os/arch: %#v", profile)
	}
	if len(profile.GetPorts()) == 0 {
		t.Fatalf("device profile must include port probe results")
	}
}
