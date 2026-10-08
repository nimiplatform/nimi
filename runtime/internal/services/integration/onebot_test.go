package integration

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func onebotTestTarget(t *testing.T, s *Service) target {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	value := target{Account: "test-account", Subject: "12345", Identity: "onebot-v11:12345", CredentialGeneration: 1, OnebotImplementation: "engineering-fixture", OnebotVersion: "1.2.3", Config: &runtimev1.IntegrationConnectionConfig{OnebotV11: &runtimev1.IntegrationOneBotV11Config{Listener: address, SelfId: "12345"}}, Public: &runtimev1.IntegrationTarget{TargetRef: "onebot-test", IntegrationId: "onebot-v11", Kind: "onebot-v11", Available: true, Operations: nativeOperations("onebot-v11")}}
	if err := s.saveTarget(context.Background(), value); err != nil {
		t.Fatal(err)
	}
	if err := s.secrets.WriteSecret("integration:"+value.Public.TargetRef, "private-token"); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestOnebotHandshakeCompletionCannotDispatchAfterActualLogout(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	value := onebotTestTarget(t, s)
	c := admittedNativePhaseCall(t, s, testDecision("consumer", 1), value, operation(value, "onebot-v11.messages.send"))
	account := accountservice.New(nil, accountservice.WithAuditStore(s.audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithCustody(&generationTestCustody{material: accountservice.AccountMaterial{AccountID: "test-account", RealmEnvironmentID: "realm", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: time.Now().Add(time.Hour)}}))
	projection, generation, _, ok := account.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("authentication absent")
	}
	s.revalidator = generationTestRevalidator{Revalidator: s.revalidator, account: account}
	c.decision.AccountID, c.decision.RealmEnvironmentID, c.decision.AccountGeneration = projection.AccountId, projection.RealmEnvironmentId, generation
	c.ctx = context.WithValue(testContext(c.decision, localappop.OperationIntegrationCallInvoke), invocationContextKey{}, c)
	done := make(chan error, 1)
	go func() {
		_, _, err := s.executeOnebot(c.ctx, value, c.op, schemaJSON(map[string]any{"conversation": nativeConversation{Kind: "private", ID: "678"}, "body": nativeBody{Kind: "text", Text: "must not dispatch"}}), "private-token")
		done <- err
	}()
	deadline := time.Now().Add(2 * time.Second)
	var conn *websocket.Conn
	var err error
	for {
		conn, _, err = dialOnebot(t, value, "Universal", "12345", "private-token")
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	defer conn.Close()
	var request struct {
		Action string `json:"action"`
		Echo   string `json:"echo"`
	}
	conn.ReadJSON(&request)
	conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]any{"user_id": 12345, "nickname": "fixture"}, "echo": request.Echo})
	if err = conn.ReadJSON(&request); err != nil || request.Action != "get_version_info" {
		t.Fatal("version phase absent", request, err)
	}
	logout, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop", DeviceId: "device", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
	if err != nil || !logout.GetAccepted() {
		t.Fatal("logout failed", logout, err)
	}
	if c.ctx.Err() != nil || closed(c.decision.SessionInvalidated) {
		t.Fatal("proof relies on delayed watcher")
	}
	conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]string{"app_name": "engineering-fixture", "app_version": "1.2.3", "protocol_version": "v11"}, "echo": request.Echo})
	if err = <-done; publicAdapterError(err) != "INTEGRATION_SCOPE_ENDED" {
		t.Fatal("late verification dispatched", err)
	}
	conn.SetReadDeadline(time.Now().Add(time.Second))
	if err = conn.ReadJSON(&request); err == nil {
		t.Fatal("business request followed logout", request)
	}
}

func TestOnebotInvocationRecordsNativeReceiptOrUnconfirmedWithoutRetry(t *testing.T) {
	for _, nativeID := range []any{-123, nil} {
		t.Run(strconv.FormatBool(nativeID != nil), func(t *testing.T) {
			s, value, _, _, conn, _ := onebotVerifiedBridge(t)
			d := testDecision("consumer", 1)
			grantTestTarget(t, s, d, value.Public.TargetRef, "onebot-v11.messages.send")
			accepted, err := s.InvokeIntegrationCall(testContext(d, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{TargetRef: value.Public.TargetRef, Operation: "onebot-v11.messages.send", InputJson: schemaJSON(map[string]any{"conversation": nativeConversation{Kind: "private", ID: "678"}, "body": map[string]string{"kind": "text", "text": "literal [CQ:at,qq=1]"}})})
			if err != nil {
				t.Fatal(err)
			}
			var request struct {
				Action string `json:"action"`
				Echo   string `json:"echo"`
				Params struct {
					Message []onebotSegment `json:"message"`
				} `json:"params"`
			}
			if err = conn.ReadJSON(&request); err != nil {
				t.Fatal(err)
			}
			if request.Action != "send_private_msg" || len(request.Params.Message) != 1 || request.Params.Message[0].Type != "text" || onebotValue(request.Params.Message[0].Data["text"]) != "literal [CQ:at,qq=1]" {
				t.Fatal("text became undeclared CQ actions", request)
			}
			conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]any{"message_id": nativeID}, "echo": request.Echo})
			fact := waitTestCall(t, s, d, accepted.Call.CallId)
			expected := "completed"
			if nativeID == nil {
				expected = "unconfirmed"
			}
			if fact.Status != expected || nativeID != nil && !strings.Contains(fact.ResultJson, `"messageId":"-123"`) {
				t.Fatal("registered dispatch falsely confirmed", fact)
			}
		})
	}
}

func TestOnebotPendingAndFrameBoundsBeforeProcessing(t *testing.T) {
	_, _, bridge, peer, conn, _ := onebotVerifiedBridge(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	results := make(chan error, 32)
	echoes := []string{}
	for i := 0; i < 32; i++ {
		go func() { _, _, err := peer.call(ctx, "get_login_info", map[string]any{}, nil); results <- err }()
		var request struct {
			Echo string `json:"echo"`
		}
		if err := conn.ReadJSON(&request); err != nil {
			t.Fatal(err)
		}
		echoes = append(echoes, request.Echo)
	}
	if _, outcome, err := peer.call(ctx, "get_login_info", map[string]any{}, nil); outcome != notDispatched || publicAdapterError(err) != "INTEGRATION_ONEBOT_ACTION_LIMIT" {
		t.Fatal("excess action allocated/dispatched", outcome, err)
	}
	for i := len(echoes) - 1; i >= 0; i-- {
		conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"user_id": 12345}, "echo": echoes[i]})
	}
	for i := 0; i < 32; i++ {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	conn.WriteMessage(websocket.TextMessage, []byte(`{"post_type":"meta_event","self_id":12345,"padding":"`+strings.Repeat("x", 1024*1024)+`"}`))
	select {
	case <-bridge.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("oversized frame kept processing")
	}
	bridge.mu.Lock()
	defer bridge.mu.Unlock()
	if publicAdapterError(bridge.failure) != "INTEGRATION_ONEBOT_FRAME_BOUNDS" {
		t.Fatal("frame excess did not retain its actual cause", bridge.failure)
	}
}

func TestOnebotSendImageOwnedBytesActualReceiptAndPreDispatchCancel(t *testing.T) {
	s, value, bridge, peer, conn, _ := onebotVerifiedBridge(t)
	_ = peer
	c := admittedNativePhaseCall(t, s, testDecision("consumer", 1), value, operation(value, "onebot-v11.messages.send"))
	var encoded bytes.Buffer
	png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 1, 1)))
	plain := encoded.Bytes()
	store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
	close(assets.release)
	s.assets = assets
	owned, err := store.Write(context.Background(), appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}, "outbound/image", "image/png", false, io.NopCloser(bytes.NewReader(plain)))
	if err != nil {
		t.Fatal(err)
	}
	input := schemaJSON(map[string]any{"conversation": nativeConversation{Kind: "group", ID: "789"}, "body": nativeBody{Kind: "image", Asset: outboundAsset{RelativePath: owned.RelativePath, SHA256: owned.SHA256, MediaType: owned.MediaType, SizeBytes: owned.SizeBytes}}})
	type result struct {
		text    string
		outcome effectOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		text, outcome, err := s.executeOnebot(c.ctx, value, c.op, input, "private-token")
		done <- result{text, outcome, err}
	}()
	var request struct {
		Action string `json:"action"`
		Echo   string `json:"echo"`
		Params struct {
			Group   int64           `json:"group_id"`
			Message []onebotSegment `json:"message"`
		} `json:"params"`
	}
	if err = conn.ReadJSON(&request); err != nil {
		t.Fatal(err)
	}
	if request.Action != "send_group_msg" || request.Params.Group != 789 || len(request.Params.Message) != 1 {
		t.Fatal("wrong targeted action", request)
	}
	file := onebotValue(request.Params.Message[0].Data["file"])
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(file, "base64://"))
	if err != nil || !strings.HasPrefix(file, "base64://") || !bytes.Equal(data, plain) {
		t.Fatal("protocol did not use exact owned bytes")
	}
	conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"message_id": -345}, "echo": request.Echo})
	got := <-done
	if got.err != nil || got.outcome != providerConfirmed || !strings.Contains(got.text, `"messageId":"-345"`) {
		t.Fatal("native signed ID not preserved", got)
	}
	s.mu.Lock()
	c.cancelRequested = true
	s.mu.Unlock()
	text, outcome, err := s.executeOnebot(c.ctx, value, c.op, input, "private-token")
	if err == nil || text != "" || outcome != notDispatched {
		t.Fatal("canceled phase dispatched", text, outcome, err)
	}
	bridge.mu.Lock()
	if bridge.feed != nil {
		t.Error("write opened event reception")
	}
	bridge.mu.Unlock()
}

func TestOnebotDisconnectStopsPendingAndOldEchoCannotConfirmNewSocket(t *testing.T) {
	s, value, b, peer, conn, release := onebotVerifiedBridge(t)
	done := make(chan effectOutcome, 1)
	go func() {
		_, outcome, _ := peer.call(context.Background(), "send_private_msg", map[string]any{}, nil)
		done <- outcome
	}()
	var old struct {
		Echo string `json:"echo"`
	}
	if err := conn.ReadJSON(&old); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	if outcome := <-done; outcome != effectUnknown {
		t.Fatal("disconnect confirmed or effect-free", outcome)
	}
	release()
	<-b.done
	next, nextRelease, err := s.acquireOnebot(context.Background(), value, "private-token")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { nextRelease(); <-next.done }()
	second, _, err := dialOnebot(t, value, "Universal", "12345", "private-token")
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	verifyOnebotFixture(t, second, "12345", "engineering-fixture", "1.2.3")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	current, err := next.wait(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan onebotReply, 1)
	go func() { reply, _, _ := current.call(ctx, "send_private_msg", map[string]any{}, nil); result <- reply }()
	var request struct {
		Echo string `json:"echo"`
	}
	second.ReadJSON(&request)
	if request.Echo == old.Echo {
		t.Fatal("echo generation reused")
	}
	second.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"message_id": 1}, "echo": old.Echo})
	second.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"message_id": 2}, "echo": request.Echo})
	reply := <-result
	if !strings.Contains(string(reply.Data), "2") {
		t.Fatal("old socket confirmed new request", reply)
	}
}
func dialOnebot(t *testing.T, value target, role, self, token string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	return websocket.DefaultDialer.Dial("ws://"+value.Config.OnebotV11.Listener+"/", http.Header{"Authorization": {"Bearer " + token}, "X-Self-ID": {self}, "X-Client-Role": {role}})
}
func verifyOnebotFixture(t *testing.T, conn *websocket.Conn, self, implementation, version string) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for _, action := range []string{"get_login_info", "get_version_info"} {
		var request struct {
			Action string `json:"action"`
			Echo   string `json:"echo"`
		}
		if err := conn.ReadJSON(&request); err != nil {
			t.Fatal(err)
		}
		if request.Action != action || request.Echo == "" {
			t.Fatal("verification was not actual", request)
		}
		var data any
		if action == "get_login_info" {
			id, _ := strconv.ParseInt(self, 10, 64)
			data = map[string]any{"user_id": id, "nickname": "Engineering fixture"}
		} else {
			data = map[string]string{"app_name": implementation, "app_version": version, "protocol_version": "v11"}
		}
		if err := conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": data, "echo": request.Echo}); err != nil {
			t.Fatal(err)
		}
	}
	conn.SetReadDeadline(time.Time{})
}
func onebotVerifiedBridge(t *testing.T) (*Service, target, *onebotBridge, *onebotPeer, *websocket.Conn, func()) {
	t.Helper()
	s := newIntegrationTestService(t, nil)
	value := onebotTestTarget(t, s)
	b, release, err := s.acquireOnebot(context.Background(), value, "private-token")
	if err != nil {
		t.Fatal(err)
	}
	conn, _, err := dialOnebot(t, value, "Universal", "12345", "private-token")
	if err != nil {
		t.Fatal(err)
	}
	verifyOnebotFixture(t, conn, "12345", "engineering-fixture", "1.2.3")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	p, err := b.wait(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { release(); conn.Close(); <-b.done })
	return s, value, b, p, conn, release
}

func TestOnebotAuthenticatedRolesAndActualIdentity(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	value := onebotTestTarget(t, s)
	b, release, err := s.acquireOnebot(context.Background(), value, "private-token")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { release(); <-b.done }()
	for _, input := range []struct {
		role, self, token string
		status            int
	}{{"Universal", "12345", "wrong", 401}, {"Universal", "999", "private-token", 403}, {"unknown", "12345", "private-token", 403}} {
		conn, response, err := dialOnebot(t, value, input.role, input.self, input.token)
		if conn != nil {
			conn.Close()
		}
		if err == nil || response == nil || response.StatusCode != input.status {
			t.Fatal("unauthenticated upgrade", input, response, err)
		}
		response.Body.Close()
	}
	event, _, err := dialOnebot(t, value, "Event", "12345", "private-token")
	if err != nil {
		t.Fatal(err)
	}
	defer event.Close()
	for _, role := range []string{"Event", "Universal"} {
		conn, response, err := dialOnebot(t, value, role, "12345", "private-token")
		if conn != nil {
			conn.Close()
		}
		if err == nil || response == nil || response.StatusCode != 409 {
			t.Fatal("duplicate role upgraded", role, err)
		}
		response.Body.Close()
	}
	api, _, err := dialOnebot(t, value, "API", "12345", "private-token")
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	verifyOnebotFixture(t, api, "12345", "engineering-fixture", "1.2.3")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err = b.wait(ctx, true); err != nil {
		t.Fatal(err)
	}
}
func TestOnebotVersionAndIdentityMismatchNeverVerify(t *testing.T) {
	for _, test := range []struct{ self, version string }{{"999", "1.2.3"}, {"12345", "changed"}} {
		t.Run(test.self+test.version, func(t *testing.T) {
			s := newIntegrationTestService(t, nil)
			value := onebotTestTarget(t, s)
			b, release, err := s.acquireOnebot(context.Background(), value, "private-token")
			if err != nil {
				t.Fatal(err)
			}
			defer func() { release(); <-b.done }()
			conn, _, err := dialOnebot(t, value, "Universal", "12345", "private-token")
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			var request struct {
				Action string `json:"action"`
				Echo   string `json:"echo"`
			}
			if err = conn.ReadJSON(&request); err != nil {
				t.Fatal(err)
			}
			id, _ := strconv.Atoi(test.self)
			conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]any{"user_id": id, "nickname": "fixture"}, "echo": request.Echo})
			if test.self == "12345" {
				if err = conn.ReadJSON(&request); err != nil {
					t.Fatal(err)
				}
				conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]string{"app_name": "engineering-fixture", "app_version": test.version, "protocol_version": "v11"}, "echo": request.Echo})
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if _, err = b.wait(ctx, false); err == nil {
				t.Fatal("wrong actual endpoint verified")
			}
		})
	}
}
func TestOnebotEchoOutOfOrderAndHonestLayeredOutcomes(t *testing.T) {
	_, _, _, peer, conn, _ := onebotVerifiedBridge(t)
	type result struct {
		response onebotReply
		outcome  effectOutcome
		err      error
	}
	first, second := make(chan result, 1), make(chan result, 1)
	go func() {
		reply, outcome, err := peer.call(context.Background(), "get_login_info", map[string]any{"order": 1}, nil)
		first <- result{reply, outcome, err}
	}()
	var one, two struct {
		Echo string `json:"echo"`
	}
	conn.ReadJSON(&one)
	go func() {
		reply, outcome, err := peer.call(context.Background(), "get_login_info", map[string]any{"order": 2}, nil)
		second <- result{reply, outcome, err}
	}()
	conn.ReadJSON(&two)
	conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"order": 999}, "echo": "foreign"})
	conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"order": 2}, "echo": two.Echo})
	conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"order": 1}, "echo": one.Echo})
	for order, ch := range []chan result{first, second} {
		got := <-ch
		if got.err != nil || got.outcome != providerConfirmed || !strings.Contains(string(got.response.Data), strconv.Itoa(order+1)) {
			t.Fatal("response crossed invocation", order, got)
		}
	}
	for _, test := range []struct {
		status   string
		code     any
		expected effectOutcome
	}{{"ok", 0, providerConfirmed}, {"failed", 100, providerRejected}, {"async", 1, effectUnknown}, {"ok", 1, effectUnknown}, {"failed", 0, effectUnknown}, {"ok", nil, effectUnknown}} {
		ch := make(chan result, 1)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		go func() {
			reply, outcome, err := peer.call(ctx, "send_private_msg", map[string]any{}, nil)
			ch <- result{reply, outcome, err}
		}()
		var request struct {
			Echo string `json:"echo"`
		}
		conn.ReadJSON(&request)
		conn.WriteJSON(map[string]any{"status": test.status, "retcode": test.code, "data": map[string]int{"message_id": -123}, "echo": request.Echo})
		got := <-ch
		cancel()
		if got.outcome != test.expected || (got.err == nil) != (test.expected == providerConfirmed) {
			t.Fatal("dishonest result", test, got)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	ch := make(chan result, 1)
	go func() {
		reply, outcome, err := peer.call(ctx, "send_private_msg", map[string]any{}, nil)
		ch <- result{reply, outcome, err}
	}()
	var request struct {
		Echo string `json:"echo"`
	}
	conn.ReadJSON(&request)
	conn.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "data": map[string]int{"message_id": 1}})
	got := <-ch
	if got.err == nil || got.outcome != effectUnknown {
		t.Fatal("missing echo confirmed", got)
	}
}
func TestOnebotNormalizedTextCQReplyImageAndProtocolPathBoundary(t *testing.T) {
	s, feed, call := feedFixture(t)
	for _, message := range []any{[]any{map[string]any{"type": "text", "data": map[string]string{"text": "before"}}, map[string]any{"type": "at", "data": map[string]string{"qq": "123"}}, map[string]any{"type": "text", "data": map[string]string{"text": "after"}}, map[string]any{"type": "reply", "data": map[string]string{"id": "-45"}}, map[string]any{"type": "image", "data": map[string]string{"file": "C:\\protocol-end\\image.png", "url": "https://gchat.qpic.cn/actual"}}}, "before[CQ:at,qq=123]after[CQ:reply,id=-45][CQ:image,file=C:\\protocol-end\\image.png,url=https://gchat.qpic.cn/actual]"} {
		id := strconv.Itoa(len(feed.events) + 1)
		data := []byte(schemaJSON(map[string]any{"post_type": "message", "self_id": 12345, "message_type": "group", "group_id": 789, "user_id": 123, "message_id": json.Number(id), "time": 1234, "message": message}))
		if err := acceptOnebotMessage(call.ctx, feed, "12345", data); err != nil {
			t.Fatal(err)
		}
		var event nativeMessage
		if json.Unmarshal(feed.events[len(feed.events)-1].payload, &event) != nil || len(event.Segments) != 4 || event.Segments[1]["kind"] != "mention" || event.Segments[2]["text"] != "after" || event.References[0].MessageID != "-45" {
			t.Fatal("order or reply lost", event)
		}
		if strings.Contains(string(feed.events[len(feed.events)-1].payload), "protocol-end") || strings.Contains(string(feed.events[len(feed.events)-1].payload), "qpic.cn") {
			t.Fatal("private location leaked")
		}
	}
	if _, err := s.fetchNativeCDN(call, nativeSource{Context: "C:\\protocol-end\\image.png", MediaKind: "image"}, "inbound/new.png"); err == nil {
		t.Fatal("remote protocol path became Runtime path")
	}
}
func TestOnebotSetupUsesActualHandshakeAndClosesListener(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	value := onebotTestTarget(t, s) // Remove only the isolated fixture row, not any user data.
	if _, err := s.backend.DB().Exec(`DELETE FROM runtime_integration_target WHERE target_ref=?`, value.Public.TargetRef); err != nil {
		t.Fatal(err)
	}
	ctx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart)
	started, err := s.StartIntegrationConnectionSetup(ctx, &runtimev1.StartIntegrationConnectionSetupRequest{Adapter: "onebot-v11", DisplayName: "Protocol engineering", Config: value.Config})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SubmitIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupSubmit), &runtimev1.SubmitIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId, Secret: "private-token"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	var conn *websocket.Conn
	for {
		conn, _, err = dialOnebot(t, value, "Universal", "12345", "private-token")
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	defer conn.Close()
	verifyOnebotFixture(t, conn, "12345", "engineering-fixture", "1.2.3")
	waitSetupStatus(t, s, ctx, started.Setup.SetupId, "completed")
	observed, err := s.GetIntegrationConnectionSetup(setupTestContext(ctx, localappop.OperationIntegrationConnectionSetupGet), &runtimev1.GetIntegrationConnectionSetupRequest{SetupId: started.Setup.SetupId})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.loadTarget(context.Background(), "test-account", observed.Setup.TargetRef)
	if err != nil || stored.OnebotImplementation != "engineering-fixture" || stored.OnebotVersion != "1.2.3" {
		t.Fatal("actual version not bound", stored, err)
	}
	listener, err := net.Listen("tcp", value.Config.OnebotV11.Listener)
	if err != nil {
		t.Fatal("verification retained idle listener", err)
	}
	listener.Close()
}
