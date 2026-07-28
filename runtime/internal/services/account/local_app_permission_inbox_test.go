package account

import (
	"context"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/grpc/metadata"
)

func TestLocalAppPermissionOwnerInboxListsAndPushesPendingRequests(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	empty, err := fixture.service.ListLocalAppPermissionRequests(context.Background(), &runtimev1.ListLocalAppPermissionRequestsRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !empty.GetAccepted() || len(empty.GetRequests()) != 0 {
		t.Fatalf("empty inbox = (%+v, %v)", empty, err)
	}
	streamCtx, cancel := context.WithCancel(context.Background())
	stream := &permissionInboxStream{ctx: streamCtx, sent: make(chan *runtimev1.LocalAppPermissionInboxEvent, 4)}
	done := make(chan error, 1)
	go func() {
		done <- fixture.service.SubscribeLocalAppPermissionRequests(&runtimev1.SubscribeLocalAppPermissionRequestsRequest{Caller: desktopAccountControlCaller()}, stream)
	}()
	initial := receivePermissionInboxEvent(t, stream.sent)
	if !initial.GetAccepted() || len(initial.GetRequests()) != 0 || initial.GetSequence() == 0 {
		t.Fatalf("initial inbox snapshot = %+v", initial)
	}
	requested, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: "Open a conversation with my selected Agent",
	})
	if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("request = (%+v, %v)", requested, err)
	}
	pushed := receivePermissionInboxEvent(t, stream.sent)
	if pushed.GetSequence() <= initial.GetSequence() || len(pushed.GetRequests()) != 1 {
		t.Fatalf("pushed inbox = %+v", pushed)
	}
	pending := pushed.GetRequests()[0]
	if pending.GetLocalAppPrincipalId() != fixture.resolver.binding.LocalAppPrincipalID || pending.GetDisplayAppId() != "sample.nimi.app" ||
		pending.GetPermissionId() != "agents.interact" || pending.GetReason() == "" || pending.GetRequestedAt() == nil || pending.GetOwnerRevision() != 1 {
		t.Fatalf("pending projection = %+v", pending)
	}
	listed, err := fixture.service.ListLocalAppPermissionRequests(context.Background(), &runtimev1.ListLocalAppPermissionRequestsRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !listed.GetAccepted() || len(listed.GetRequests()) != 1 {
		t.Fatalf("listed inbox = (%+v, %v)", listed, err)
	}
	cancel()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatalf("subscription exit = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("subscription did not stop")
	}
}

func TestLocalAppPermissionOwnerInboxRejectsNonOwnerCaller(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	response, err := fixture.service.ListLocalAppPermissionRequests(context.Background(), &runtimev1.ListLocalAppPermissionRequestsRequest{Caller: firstPartyCaller()})
	if err != nil || response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED {
		t.Fatalf("non-owner inbox = (%+v, %v)", response, err)
	}
}

type permissionInboxStream struct {
	ctx  context.Context
	sent chan *runtimev1.LocalAppPermissionInboxEvent
	mu   sync.Mutex
}

func (stream *permissionInboxStream) Send(event *runtimev1.LocalAppPermissionInboxEvent) error {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	select {
	case stream.sent <- event:
		return nil
	case <-stream.ctx.Done():
		return stream.ctx.Err()
	}
}

func (stream *permissionInboxStream) SetHeader(metadata.MD) error  { return nil }
func (stream *permissionInboxStream) SendHeader(metadata.MD) error { return nil }
func (stream *permissionInboxStream) SetTrailer(metadata.MD)       {}
func (stream *permissionInboxStream) Context() context.Context     { return stream.ctx }
func (stream *permissionInboxStream) SendMsg(any) error            { return nil }
func (stream *permissionInboxStream) RecvMsg(any) error            { return nil }

func receivePermissionInboxEvent(t *testing.T, events <-chan *runtimev1.LocalAppPermissionInboxEvent) *runtimev1.LocalAppPermissionInboxEvent {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for permission inbox event")
		return nil
	}
}
