package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Isolated protocol input drives the real registered-subject Invoke, Weixin
// receiver, normalized feed and terminal SQLite record; this is not live login.
func initialReadProtocol(t *testing.T, polls *atomic.Int32, entered, release chan struct{}) http.RoundTripper {
	t.Helper()
	return testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/ilink/bot/getupdates" {
			t.Error("unexpected external request", req.URL.Path)
			return nil, fmt.Errorf("unexpected request")
		}
		var input struct {
			Cursor string `json:"get_updates_buf"`
		}
		if json.NewDecoder(req.Body).Decode(&input) != nil {
			return nil, fmt.Errorf("invalid protocol request")
		}
		if input.Cursor != "" {
			<-req.Context().Done()
			return nil, req.Context().Err()
		}
		if polls.Add(1) == 1 && entered != nil {
			close(entered)
		}
		if release != nil {
			<-release
		}
		// The official GetUpdatesResp omits success codes on normal responses.
		return jsonResponse(map[string]any{"get_updates_buf": "fixture-next", "msgs": []map[string]any{
			{"message_id": 101, "from_user_id": "peer-a", "message_type": 1, "context_token": "fixture-context-a", "item_list": []map[string]any{{"type": 1, "text_item": map[string]string{"text": "message-a"}}}},
			{"message_id": 102, "from_user_id": "peer-b", "message_type": 1, "context_token": "fixture-context-b", "item_list": []map[string]any{{"type": 1, "text_item": map[string]string{"text": "message-b"}}}},
		}}), nil
	})
}

func initialReadTarget(t *testing.T, s *Service) target {
	t.Helper()
	value := seedNativeMediaSource(t, s, "weixin", []byte("fixture"))
	s.nativeReceivers[value.Public.TargetRef].cancel()
	delete(s.nativeReceivers, value.Public.TargetRef)
	return value
}

func invokeInitialRead(t *testing.T, s *Service, d accountservice.LocalAppCallerDecision, value target, input string) *runtimev1.IntegrationCall {
	t.Helper()
	response, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "weixin.updates.read", InputJson: input})
	if err != nil {
		t.Fatal(err)
	}
	return response.Call
}

func waitInitialReaders(t *testing.T, s *Service, id string, count int) *nativeFeed {
	t.Helper()
	until := time.Now().Add(3 * time.Second)
	for time.Now().Before(until) {
		s.mu.Lock()
		if r := s.nativeReceivers[id]; r != nil {
			r.feed.mu.Lock()
			readers := r.feed.readers
			r.feed.mu.Unlock()
			s.mu.Unlock()
			if readers == count {
				return r.feed
			}
		} else {
			s.mu.Unlock()
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("expected shared readers were not admitted", count)
	return nil
}

func TestNativeInitialReadPublicInvokeWithoutKnownConversation(t *testing.T) {
	for _, test := range []struct {
		name, input string
		want        int
	}{
		{"omitted", `{"waitMs":25000}`, 2},
		{"empty", `{"conversations":[],"waitMs":25000}`, 2},
		{"filtered", `{"conversations":["private:peer-b"],"waitMs":25000}`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			var polls atomic.Int32
			s := newIntegrationTestService(t, initialReadProtocol(t, &polls, nil, nil))
			value := initialReadTarget(t, s)
			d := testDecision("registered-lab", 1)
			grantTestTarget(t, s, d, value.Public.TargetRef, "weixin.updates.read")
			var input map[string]any
			if json.Unmarshal([]byte(test.input), &input) != nil {
				t.Fatal("invalid fixture input")
			}
			messages := map[string]nativeMessage{}
			for reads := 0; reads < 3 && len(messages) < test.want; reads++ {
				call := invokeInitialRead(t, s, d, value, schemaJSON(input))
				result := waitTestCall(t, s, d, call.CallId)
				var page struct {
					Cursor string
					Events []nativeMessage
				}
				if result.Status != "completed" || json.Unmarshal([]byte(result.ResultJson), &page) != nil || page.Cursor == "" || len(page.Events) == 0 {
					t.Fatal("first/continuing read did not deliver declared view", result)
				}
				for _, message := range page.Events {
					messages[message.MessageID] = message
				}
				input["cursor"] = page.Cursor
			}
			if len(messages) != test.want {
				t.Fatal("bounded pages lost messages", messages)
			}
			if test.name == "filtered" && messages["102"].Conversation.ID != "peer-b" {
				t.Fatal("filter leaked another conversation")
			}
			denied := testDecision("unpermitted-app", 3)
			_, err := s.InvokeIntegrationCall(testContext(denied, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "weixin.updates.read", InputJson: `{}`})
			if status.Code(err) != codes.PermissionDenied {
				t.Fatal("empty filters widened standing permission", err)
			}
			foreign := d
			foreign.AccountID = "other-account"
			_, err = s.InvokeIntegrationCall(testContext(foreign, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "weixin.updates.read", InputJson: `{}`})
			if status.Code(err) != codes.NotFound {
				t.Fatal("empty filters exposed another account", err)
			}
		})
	}
}

func TestNativeUnfilteredSharedInvokeKeepsRemainingAppAfterCancel(t *testing.T) {
	var polls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	s := newIntegrationTestService(t, initialReadProtocol(t, &polls, entered, release))
	value := initialReadTarget(t, s)
	one, two := testDecision("registered-lab", 1), testDecision("registered-nimigo", 2)
	for _, d := range []accountservice.LocalAppCallerDecision{one, two} {
		grantTestTarget(t, s, d, value.Public.TargetRef, "weixin.updates.read")
	}
	first := invokeInitialRead(t, s, one, value, `{"waitMs":25000}`)
	<-entered
	second := invokeInitialRead(t, s, two, value, `{"conversations":[],"waitMs":25000}`)
	waitInitialReaders(t, s, value.Public.TargetRef, 2)
	if polls.Load() != 1 {
		t.Fatal("consumers created independent upstream polls")
	}
	if _, err := s.CancelIntegrationCall(testContext(one, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: first.CallId}); err != nil {
		t.Fatal(err)
	}
	stopped := waitTestCall(t, s, one, first.CallId)
	if stopped.Status != "canceled" || stopped.ResultJson != "" {
		t.Fatal("stopped consumer received a body", stopped)
	}
	unblock()
	result := waitTestCall(t, s, two, second.CallId)
	var page struct {
		Cursor string
		Events []nativeMessage
	}
	if result.Status != "completed" || json.Unmarshal([]byte(result.ResultJson), &page) != nil || len(page.Events) == 0 {
		t.Fatal("one App stopped the remaining reader", result)
	}
	if len(page.Events) == 1 {
		next := invokeInitialRead(t, s, two, value, schemaJSON(map[string]any{"conversations": []string{}, "cursor": page.Cursor, "waitMs": 25000}))
		result = waitTestCall(t, s, two, next.CallId)
		if result.Status != "completed" || json.Unmarshal([]byte(result.ResultJson), &page) != nil || len(page.Events) != 1 || page.Events[0].Conversation.ID != "peer-b" {
			t.Fatal("independent remaining reader lost continuation", result)
		}
	}
}

func TestNativeUnfilteredInvokeRejectsLateProtocolAfterStop(t *testing.T) {
	for _, stop := range []string{"cancel", "revoke"} {
		t.Run(stop, func(t *testing.T) {
			var polls atomic.Int32
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			s := newIntegrationTestService(t, initialReadProtocol(t, &polls, entered, release))
			value := initialReadTarget(t, s)
			d := testDecision("registered-lab", 1)
			s.registrations = integrationTestRegistrations{{Subject: d.RegisteredAppSubject, AppID: d.AppID, DisplayName: "Lab"}}
			grantTestTarget(t, s, d, value.Public.TargetRef, "weixin.updates.read")
			call := invokeInitialRead(t, s, d, value, `{"waitMs":25000}`)
			<-entered
			feed := waitInitialReaders(t, s, value.Public.TargetRef, 1)
			if stop == "cancel" {
				if _, err := s.CancelIntegrationCall(testContext(d, localappop.OperationIntegrationCallCancel), &runtimev1.CancelIntegrationCallRequest{CallId: call.CallId}); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := s.SetIntegrationPermission(desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet), &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", d.AccountID, d.RegisteredAppSubject), TargetRef: value.Public.TargetRef}); err != nil {
					t.Fatal(err)
				}
			}
			unblock()
			result := waitTestCall(t, s, d, call.CallId)
			s.workers.Wait()
			feed.mu.Lock()
			events := len(feed.events)
			feed.mu.Unlock()
			if result.Status != "canceled" || result.ResultJson != "" || events != 0 {
				t.Fatal("stopped unfiltered read published late private data", result, events)
			}
		})
	}
}
