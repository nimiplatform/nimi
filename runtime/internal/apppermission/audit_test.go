package apppermission

import (
	"context"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type failingPermissionAuditSink struct{ err error }

func (sink failingPermissionAuditSink) AppendEventChecked(*runtimev1.AuditEventRecord) error {
	return sink.err
}

func TestPermissionAuditEmitsDistinctTransitionAndOperationUseEvents(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	store := auditlog.New(32, 32)
	emitter := NewAuditEmitter(store)
	binding := AuditBinding{
		OwnerSubjectID: "acct-1", LocalAppPrincipalID: "lap_v1_one", DisplayAppID: "sample.nimi.app",
		PermissionID: "agents.interact", SelectorDigest: "lasd_v1_one",
		OldPosture: PosturePending, NewPosture: PostureGranted, Trigger: "owner_approve",
		Timestamp: now, OwnerRevision: 2,
	}
	if err := emitter.EmitDecisionTransition(context.Background(), binding); err != nil {
		t.Fatal(err)
	}
	use := OperationUseAudit{Binding: binding, ProtectedOperation: "runtime_agent.conversation.open", ProtectedResourceID: "agent-one"}
	use.Binding.OldPosture = PostureGranted
	use.Binding.NewPosture = PostureGranted
	use.Binding.Trigger = "operation_use"
	if err := emitter.EmitOperationUse(context.Background(), use); err != nil {
		t.Fatal(err)
	}
	listed, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: permissionAuditDomain})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.GetEvents()) != 2 || listed.GetEvents()[0].GetAuditId() == listed.GetEvents()[1].GetAuditId() {
		t.Fatalf("permission events were missing or coalesced: %+v", listed.GetEvents())
	}
	byAction := make(map[string]*runtimev1.AuditEventRecord, 2)
	for _, event := range listed.GetEvents() {
		byAction[event.GetOperation()] = event
		fields := event.GetPayload().GetFields()
		for _, key := range []string{"owner_subject_id", "local_app_principal_id", "display_app_id", "permission_id", "selector_digest", "old_posture", "new_posture", "trigger", "timestamp", "owner_revision"} {
			if fields[key] == nil {
				t.Fatalf("event %q missing payload field %q: %+v", event.GetOperation(), key, fields)
			}
		}
		for _, forbidden := range []string{"credential", "token", "proof"} {
			if fields[forbidden] != nil {
				t.Fatalf("event contains forbidden secret field %q", forbidden)
			}
		}
	}
	if byAction[permissionDecisionAuditOperation].GetPayload().GetFields()["protected_operation_id"] != nil {
		t.Fatal("decision transition carried protected operation identity")
	}
	useFields := byAction[permissionOperationUseAuditAction].GetPayload().GetFields()
	if useFields["protected_operation_id"].GetStringValue() != use.ProtectedOperation || useFields["protected_resource_id"].GetStringValue() != use.ProtectedResourceID {
		t.Fatalf("protected owner operation audit = %+v", useFields)
	}
	public, err := store.ListDesktopEvents(&runtimev1.ListDesktopAuditEventsRequest{
		Domain: permissionAuditDomain, FromTime: timestamppb.New(now.Add(-time.Second)), ToTime: timestamppb.New(now.Add(time.Second)),
	})
	if err != nil || len(public.GetEvents()) != 2 {
		t.Fatalf("public permission audit projection = (%+v, %v)", public, err)
	}
	for _, event := range public.GetEvents() {
		if event.GetOperation() != permissionDecisionAuditOperation && event.GetOperation() != permissionOperationUseAuditAction {
			t.Fatalf("public projection exposed protected operation identity: %+v", event)
		}
	}
}

func TestPermissionAuditFailureBlocksEmitterPositiveResult(t *testing.T) {
	sentinel := errors.New("audit persistence failed")
	emitter := NewAuditEmitter(failingPermissionAuditSink{err: sentinel})
	binding := AuditBinding{
		OwnerSubjectID: "acct-1", LocalAppPrincipalID: "lap_v1_one", DisplayAppID: "sample.nimi.app",
		PermissionID: "agents.interact", SelectorDigest: "lasd_v1_one",
		OldPosture: PosturePending, NewPosture: PostureGranted, Trigger: "owner_approve",
		Timestamp: time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC), OwnerRevision: 2,
	}
	if err := emitter.EmitDecisionTransition(context.Background(), binding); !errors.Is(err, sentinel) {
		t.Fatalf("transition audit error = %v", err)
	}
	if err := emitter.EmitOperationUse(context.Background(), OperationUseAudit{
		Binding: binding, ProtectedOperation: "runtime_agent.conversation.open", ProtectedResourceID: "agent-one",
	}); !errors.Is(err, sentinel) {
		t.Fatalf("operation-use audit error = %v", err)
	}
}
