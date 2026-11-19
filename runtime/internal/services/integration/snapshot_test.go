package integration

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc"
)

type snapshotTestStream struct {
	grpc.ServerStream
	ctx    context.Context
	frames chan *runtimev1.SubscribeIntegrationSnapshotsResponse
}

func (s snapshotTestStream) Context() context.Context { return s.ctx }
func (s snapshotTestStream) Send(f *runtimev1.SubscribeIntegrationSnapshotsResponse) error {
	select {
	case s.frames <- f:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}

func TestSnapshotStreamIsIndependentOfInvocationsAndRevalidatesGrant(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	c, p := testDecision("web", 1), testDecision("pc", 2)
	op := testOperation("read")
	on := true
	op.SnapshotRead = &on
	op.Name = "session.progress"
	op.InputSchemaJson = `{"type":"object","properties":{"session":{"type":"string"}},"required":["session"]}`
	op.OutputSchemaJson = `{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}`
	target, err := s.RegisterIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderRegister), &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "live", DisplayName: "PC", Operations: []*runtimev1.IntegrationOperation{op}})
	if err != nil {
		t.Fatal(err)
	}
	q := &runtimev1.SubscribeIntegrationSnapshotsRequest{TargetRef: target.Target.TargetRef, Operation: op.Name, InputJson: `{"session":"one"}`}
	ctx, cancel := context.WithTimeout(testContext(c, localappop.OperationIntegrationSnapshotsSubscribe), 8*time.Second)
	defer cancel()
	stream := snapshotTestStream{ctx: ctx, frames: make(chan *runtimev1.SubscribeIntegrationSnapshotsResponse, 4)}
	if err = s.SubscribeIntegrationSnapshots(q, stream); err == nil {
		t.Fatal("missing grant accepted")
	}
	grantTestTarget(t, s, c, q.TargetRef, q.Operation)
	if _, err = s.InvokeIntegrationCall(testContext(c, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: q.TargetRef, Operation: q.Operation, InputJson: q.InputJson}); err == nil {
		t.Fatal("observation allowed ordinary invocation")
	}
	done := make(chan error, 1)
	connect := func() { go func() { done <- s.SubscribeIntegrationSnapshots(q, stream) }() }
	read := func() *runtimev1.IntegrationProviderCall {
		t.Helper()
		r, err := s.PollIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{WaitMs: 1500})
		if err != nil || len(r.Calls) != 1 {
			t.Fatal(r, err)
		}
		return r.Calls[0]
	}
	reply := func(id, value string) bool {
		t.Helper()
		r, err := s.CompleteIntegrationProvider(testContext(p, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: value})
		if err != nil {
			t.Fatal(err)
		}
		return r.Accepted
	}
	next := func() *runtimev1.SubscribeIntegrationSnapshotsResponse {
		t.Helper()
		select {
		case f := <-stream.frames:
			return f
		case <-ctx.Done():
			t.Fatal(ctx.Err())
			return nil
		}
	}
	connect()
	first := read()
	if first.AfterSnapshot == nil || *first.AfterSnapshot != "" || first.InputJson != q.InputJson || !reply(first.CallId, `{"text":"a"}`) {
		t.Fatal(first)
	}
	a := next()
	second := read()
	if second.GetAfterSnapshot() != a.Cursor || reply(first.CallId, `{"text":"stale"}`) || !reply(second.CallId, a.ResultJson) {
		t.Fatal("cursor or stale delivery")
	}
	third := read()
	if !reply(third.CallId, `{"text":"ab"}`) {
		t.Fatal("rejected live update")
	}
	b := next()
	if b.ResultJson != `{"text":"ab"}` || b.Cursor == a.Cursor {
		t.Fatal("duplicate or incorrect frame", b)
	}
	outstanding := read()
	if _, err := s.SetIntegrationPermission(desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet), &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", c.AccountID, c.RegisteredAppSubject), TargetRef: q.TargetRef}); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("revoked stream remained live")
	}
	if reply(outstanding.CallId, `{"text":"private"}`) {
		t.Fatal("revoked result accepted")
	}
	grantTestTarget(t, s, c, q.TargetRef, q.Operation)
	connect()
	again := read()
	if again.GetAfterSnapshot() != "" || !reply(again.CallId, b.ResultJson) || next().Cursor != b.Cursor {
		t.Fatal("reconnect did not return current state")
	}
	cancel()
	<-done
	var n int
	if err := s.backend.DB().QueryRow("SELECT COUNT(*) FROM runtime_integration_call").Scan(&n); err != nil || n != 0 {
		t.Fatal("observation generated call history", n, err)
	}
}
