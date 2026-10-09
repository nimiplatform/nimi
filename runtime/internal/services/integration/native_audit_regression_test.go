package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestNativeReaderExitCannotCancelAcrossConcurrentJoin(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	value := initialReadTarget(t, s)
	d := testDecision("consumer", 1)
	c := admittedNativePhaseCall(t, s, d, value, operation(value, "weixin.updates.read"))
	entered := make(chan struct{})
	adapter := s.adapters["weixin"]
	adapter.receive = func(ctx context.Context, _ target, _ string, _ *nativeFeed) error {
		close(entered)
		<-ctx.Done()
		return ctx.Err()
	}
	s.adapters["weixin"] = adapter
	returned := make(chan error, 1)
	go func() { _, err := s.readNativeUpdates(c.ctx, value, "", `{"waitMs":25000}`); returned <- err }()
	<-entered
	feed := waitInitialReaders(t, s, value.Public.TargetRef, 1)
	s.mu.Lock()
	r := s.nativeReceivers[value.Public.TargetRef]
	c.cancel() // read returns, but leaving must wait for the same owner as join
	select {
	case <-returned:
		s.mu.Unlock()
		t.Fatal("last reader left without the connection owner lock")
	case <-time.After(30 * time.Millisecond):
	}
	feed.mu.Lock()
	if feed.readers != 1 || r.ctx.Err() != nil {
		feed.mu.Unlock()
		s.mu.Unlock()
		t.Fatal("exit canceled a receiver during an admitted join")
	}
	// A new reader admitted under this owner lock wins before the old exit.
	other := &invocation{}
	feed.readers++
	feed.leases[other] = struct{}{}
	feed.mu.Unlock()
	s.mu.Unlock()
	<-returned
	s.mu.Lock()
	feed.mu.Lock()
	if feed.readers != 1 || r.ctx.Err() != nil {
		t.Error("old exit canceled the new reader")
	}
	delete(feed.leases, other)
	feed.readers--
	r.cancel()
	feed.mu.Unlock()
	s.mu.Unlock()
}

func TestWeixinPollKeepsNonemptyCursorAndGatesEveryAcknowledgment(t *testing.T) {
	for _, invalidation := range []string{"cancel", "revoke", "empty-revoke", "expiry", "session", "generation", "shared-reader", "commit-failed"} {
		t.Run(invalidation, func(t *testing.T) {
			var requests int
			var s *Service
			var c *invocation
			var value target
			var session chan struct{}
			s = newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
				var input struct {
					Cursor string `json:"get_updates_buf"`
				}
				if json.NewDecoder(req.Body).Decode(&input) != nil {
					t.Fatal("invalid poll")
				}
				want := []string{"", "A", "A", "A", "B"}
				if requests >= len(want) || input.Cursor != want[requests] {
					t.Errorf("poll %d lost cursor: %q", requests, input.Cursor)
				}
				requests++
				if requests == 4 {
					switch invalidation {
					case "cancel", "shared-reader":
						c.cancel()
					case "revoke", "empty-revoke":
						grantTestTarget(t, s, c.decision, value.Public.TargetRef)
					case "expiry":
						c.decision.ExpiresAt = time.Now().Add(-time.Second)
					case "session":
						close(session)
					case "generation":
						value.CredentialGeneration++
						if err := s.saveTarget(context.Background(), value); err != nil {
							t.Fatal(err)
						}
					}
				}
				if requests == 5 {
					return nil, fmt.Errorf("explicit end of shared-reader proof")
				}
				body := []string{`{"msgs":[],"get_updates_buf":"A"}`, `{"ret":0,"msgs":[]}`, `{"ret":0,"msgs":[],"get_updates_buf":""}`, `{"msgs":[],"get_updates_buf":"B"}`}[requests-1]
				if requests == 4 && invalidation == "empty-revoke" {
					body = `{"msgs":[]}`
				}
				if requests == 4 && invalidation == "commit-failed" {
					body = `{"msgs":[{"message_type":1,"from_user_id":"peer","group_id":"invalid","item_list":[{"type":1}]}],"get_updates_buf":"B"}`
				}
				return jsonResponse(json.RawMessage(body)), nil
			}))
			value = initialReadTarget(t, s)
			d := testDecision("reader", 1)
			session = make(chan struct{})
			d.SessionInvalidated = session
			c = admittedNativePhaseCall(t, s, d, value, operation(value, "weixin.updates.read"))
			feed := newNativeFeed()
			feed.leases[c] = struct{}{}
			feed.readers = 1
			if invalidation == "shared-reader" {
				other := admittedNativePhaseCall(t, s, testDecision("other", 2), value, c.op)
				feed.leases[other] = struct{}{}
				feed.readers++
			}
			secret, _, _ := s.secrets.ReadSecret("integration:" + value.Public.TargetRef)
			err := s.receiveWeixin(context.Background(), value, secret, feed)
			if err == nil {
				t.Fatal("loop did not stop")
			}
			wantRequests, wantCursor := 4, "A"
			if invalidation == "shared-reader" {
				wantRequests, wantCursor = 5, "B"
			}
			if requests != wantRequests || feed.upstreamCursor != wantCursor {
				t.Fatal("invalid reader acknowledged cursor", requests, feed.upstreamCursor)
			}
		})
	}
}

func TestIntegrationPermissionFinalManagementFence(t *testing.T) {
	for _, revoke := range []bool{false, true} {
		t.Run(fmt.Sprint("revoke=", revoke), func(t *testing.T) {
			s := newIntegrationTestService(t, nil)
			consumer := testDecision("consumer", 2)
			value := registerTestProvider(t, s, testDecision("provider", 1), "read")
			s.registrations = integrationTestRegistrations{{Subject: consumer.RegisteredAppSubject, AppID: consumer.AppID, DisplayName: "Consumer"}}
			if revoke {
				grantTestTarget(t, s, consumer, value, "document.read")
			}
			ctx := desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet)
			d, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
			session := make(chan struct{})
			d.SessionInvalidated = session
			ctx = accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d)
			previous := s.revalidator
			var admitted atomic.Bool
			s.revalidator = testRevalidator(func(ctx context.Context, i localappop.Ingress) (context.Context, error) {
				authorized, err := previous.AuthorizeLocalAppIngress(ctx, i)
				if err == nil && i == localappop.IngressIntegrationPermissionSet && !admitted.Swap(true) {
					close(session)
				}
				return authorized, err
			})
			ops := []string{"document.read"}
			if revoke {
				ops = nil
			}
			_, err := s.SetIntegrationPermission(ctx, &runtimev1.SetIntegrationPermissionRequest{TargetRef: value, ConsumerRef: ref("icons_", consumer.AccountID, consumer.RegisteredAppSubject), Operations: ops})
			if err == nil || ctx.Err() != nil {
				t.Fatal("permission mutated after session invalidation without async cancellation", err)
			}
			if s.permitted(context.Background(), consumer.AccountID, consumer.RegisteredAppSubject, value, "document.read") != revoke {
				t.Fatal("permission row changed outside final management fence")
			}
			operation := "integration.permission.set"
			if revoke {
				operation = "integration.permission.revoke"
			}
			requireIntegrationAuditCount(t, s, operation, 0, 1)
		})
	}
}

func TestFeishuFinalMessageRequestByteLimits(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodPut} {
		for _, msgType := range []string{"text", "interactive"} {
			limit := 150 * 1024
			if msgType == "interactive" {
				limit = 30 * 1024
			}
			body := map[string]any{"content": "", "msg_type": msgType}
			base, _ := json.Marshal(body)
			for _, delta := range []int{-1, 0, 1} {
				body["content"] = strings.Repeat("a", limit-len(base)+delta)
				err := validateFeishuMessageRequest(&larkcore.ApiReq{HttpMethod: method, Body: body}, msgType)
				if (err != nil) != (delta > 0) {
					t.Fatal("final byte boundary", method, msgType, delta, err)
				}
			}
		}
	}
	for _, content := range []string{strings.Repeat("界", 11000), strings.Repeat("\"", 16000), strings.Repeat("<", 6000)} {
		if validateFeishuMessageRequest(&larkcore.ApiReq{Body: map[string]any{"content": content}}, "interactive") == nil {
			t.Fatal("UTF-8/outer escaping was not counted")
		}
	}
	var writes atomic.Int32
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "tenant_access_token") {
			return jsonResponse(map[string]any{"code": 0, "tenant_access_token": "fixture", "expire": 7200}), nil
		}
		writes.Add(1)
		return nil, fmt.Errorf("oversized message dispatched")
	}))
	value := seedNativeMediaSource(t, s, "feishu", []byte("fixture"))
	c := admittedNativePhaseCall(t, s, testDecision("consumer", 1), value, operation(value, "feishu.messages.send"))
	input := schemaJSON(map[string]any{"conversation": nativeConversation{Kind: "chat", ID: "specified"}, "body": nativeBody{Kind: "card", CardJSON: schemaJSON(map[string]string{"text": strings.Repeat("x", 40000)})}})
	_, outcome, err := s.executeFeishu(c.ctx, value, c.op, input, "fixture")
	if publicAdapterError(err) != "INTEGRATION_FEISHU_MESSAGE_TOO_LARGE" || outcome != notDispatched || writes.Load() != 0 {
		t.Fatal("oversized message outcome", err, outcome, writes.Load())
	}
}
