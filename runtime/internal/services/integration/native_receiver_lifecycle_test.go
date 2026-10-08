package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

func TestNativeExplicitReadWaitsForPreviousDrainAndCanCancel(t *testing.T) {
	for _, cancelRead := range []bool{false, true} {
		t.Run(map[bool]string{false: "drain-then-read", true: "cancel-during-drain"}[cancelRead], func(t *testing.T) {
			s := newIntegrationTestService(t, nil)
			nativeTarget := seedNativeMediaSource(t, s, "weixin", []byte("fixture"))
			old := s.nativeReceivers[nativeTarget.Public.TargetRef]
			old.cancel()
			old.done = make(chan struct{})
			started := make(chan struct{})
			adapter := s.adapters["weixin"]
			adapter.receive = func(ctx context.Context, target target, _ string, feed *nativeFeed) error {
				close(started)
				if err := feed.acceptWeixin(ctx, target, weixinCredential{BotID: "bot"}, weixinMessage{ID: json.Number("123"), From: "specified", Type: 1, Context: "private-context", Items: []weixinItem{{Type: 1}}}); err != nil {
					return err
				}
				<-ctx.Done()
				return ctx.Err()
			}
			s.adapters["weixin"] = adapter
			d := testDecision("consumer", 1)
			grantTestTarget(t, s, d, nativeTarget.Public.TargetRef, "weixin.updates.read")
			accepted, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: nativeTarget.Public.TargetRef, Operation: "weixin.updates.read", InputJson: `{"conversations":["private:specified"],"cursor":"","waitMs":25000}`})
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-started:
				t.Fatal("new receiver started before old drain")
			case <-time.After(30 * time.Millisecond):
			}
			if cancelRead {
				if _, err = s.CancelIntegrationCall(testContext(d, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: accepted.Call.CallId}); err != nil {
					t.Fatal(err)
				}
				result := waitTestCall(t, s, d, accepted.Call.CallId)
				if result.Status != "canceled" {
					t.Fatal(result)
				}
				close(old.done)
				select {
				case <-started:
					t.Fatal("canceled read restarted business")
				case <-time.After(30 * time.Millisecond):
				}
			} else {
				close(old.done)
				result := waitTestCall(t, s, d, accepted.Call.CallId)
				if result.Status != "completed" {
					t.Fatal("explicit next read failed", result)
				}
				var page struct {
					Events      []nativeMessage
					CoverageGap string
				}
				if json.Unmarshal([]byte(result.ResultJson), &page) != nil || len(page.Events) != 1 || page.Events[0].MessageID != "123" || page.CoverageGap != "reconnect" {
					t.Fatal(result.ResultJson)
				}
			}
		})
	}
}

func TestRemoveConnectionDrainsReceiverEnteringAcceptOutsideOwnerLock(t *testing.T) {
	s, feed, call := feedFixture(t)
	ctx, cancel := context.WithCancel(s.ctx)
	r := &nativeReceiver{ctx: ctx, cancel: cancel, done: make(chan struct{}), feed: feed, generation: call.target.CredentialGeneration}
	entered, attempt, allowAccept := make(chan struct{}), make(chan struct{}), make(chan struct{})
	feed.publish = func(commit func() error) error {
		close(entered)
		<-ctx.Done() // deletion has canceled the receiver while holding s.mu
		close(attempt)
		<-allowAccept
		return s.commitNativeFeed(feed, commit)
	}
	s.mu.Lock()
	s.nativeReceivers[call.target.Public.TargetRef] = r
	s.mu.Unlock()
	accepted := make(chan error, 1)
	go func() {
		defer close(r.done)
		accepted <- feed.Accept(context.Background(), "late", "private:1", []byte(`{"text":"late"}`))
	}()
	<-entered
	removeCtx, stopRemove := context.WithTimeout(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionRemove), 3*time.Second)
	defer stopRemove()
	removed := make(chan error, 1)
	go func() {
		_, err := s.RemoveIntegrationConnection(removeCtx, &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: call.target.Public.TargetRef})
		removed <- err
	}()
	<-attempt
	// A distinct call cannot enter while the old identity is reserved for drain.
	_, err := s.InvokeIntegrationCall(testContext(call.decision, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: call.target.Public.TargetRef, Operation: call.op.Name, InputJson: `{"chatIds":["1"],"waitMs":0}`})
	if err == nil {
		t.Fatal("new call admitted during deletion")
	}
	if _, err := s.loadTarget(context.Background(), call.decision.AccountID, call.target.Public.TargetRef); err != nil {
		t.Fatal("identity released before drain", err)
	}
	close(allowAccept)
	select {
	case err := <-removed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("remove held Integration mutex while awaiting Accept")
	}
	if err := <-accepted; err == nil || len(feed.events) != 0 {
		t.Fatal("canceled receiver published during deletion", err)
	}
	if _, err := s.loadTarget(context.Background(), call.decision.AccountID, call.target.Public.TargetRef); err == nil {
		t.Fatal("drained connection remained")
	}
}
