package realmrealtime

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestListRealmChatsUsesCurrentCredentialAndProjectsBoundedOwnerRows(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/human/chats" || request.URL.Query().Get("cursor") != "chat-before" || request.URL.Query().Get("limit") != "7" {
			t.Errorf("Realm Chat list request = %s", request.URL.String())
		}
		if request.Header.Get("authorization") != "Bearer access-token" {
			t.Errorf("Realm Chat list authorization = %q", request.Header.Get("authorization"))
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"items":[{"id":"chat-1","createdAt":"2026-08-26T01:00:00Z","updatedAt":"2026-08-26T02:00:00Z","lastMessageAt":"2026-08-26T02:00:00Z","unreadCount":3,"otherUser":{"id":"user-2","handle":"friend","displayName":"Friend","avatarUrl":"https://cdn.example/friend.png","status":"ACTIVE","createdAt":"2026-01-01T00:00:00Z"},"lastMessage":null}],"nextCursor":"chat-next"}`))
	}))
	defer server.Close()
	invalidated := make(chan struct{})
	service := New(nil, realmListAccountProvider{lease: accountservice.RealmRealtimeAccountLease{
		AccountID: "account-1", Generation: 1, Invalidated: invalidated,
		AccessToken: "access-token", RealmBaseURL: server.URL, RealmRealtimeURL: "http://127.0.0.1:3003",
	}})
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.test", "x-nimi-session-id", "session-1"))
	result, err := service.ListRealmChats(ctx, &runtimev1.ListRealmChatsRequest{Cursor: "chat-before", Limit: 7})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.GetItems()) != 1 || result.GetItems()[0].GetChatId() != "chat-1" ||
		result.GetItems()[0].GetOtherUser().GetCreatedAt() == nil || result.GetItems()[0].GetUnreadCount() != 3 || result.GetNextCursor() != "chat-next" {
		t.Fatalf("Realm Chat list projection = %+v", result)
	}
}

func TestListRealmChatsRejectsOutOfContractLimitBeforeOwnerCall(t *testing.T) {
	service := New(nil, realmListAccountProvider{})
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.test"))
	_, err := service.ListRealmChats(ctx, &runtimev1.ListRealmChatsRequest{Limit: 51})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("limit 51 error = %v", err)
	}
}

func TestRealmControlSlowConsumerPreservesCauseAndTerminalizesExactSubscription(t *testing.T) {
	service, channel, subscription := newRealmSubscriptionFixture(t, 2)
	for index := 0; index < 2; index++ {
		if _, err := subscription.stream.Publish(channel.generation, subscriptionEvent(channel, subscription)); err != nil {
			t.Fatal(err)
		}
	}
	err := service.publishControl(channel, subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, "")
	if !errors.Is(err, realtimecore.ErrSlowConsumer) || status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("control overflow error = %v", err)
	}
	service.terminalizeSubscription(channel, subscription, realtimecore.TerminalSlowConsumer)
	if _, err := channelSubscription(channel, subscription.id); status.Code(err) != codes.NotFound {
		t.Fatalf("terminalized subscription remained bound: %v", err)
	}
	reader, release, err := subscription.stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	count := 0
	for event := range reader {
		count++
		if !realmSubscriptionEventTerminal(event) || event.GetControl().GetTerminalReason() != runtimev1.RealtimeTerminalReason_REALTIME_TERMINAL_REASON_SLOW_CONSUMER {
			t.Fatalf("slow-consumer terminal = %+v", event)
		}
	}
	if count != 1 {
		t.Fatalf("terminal event count = %d", count)
	}
}

func TestRealmOpeningFallbackFailsClosedWhenSameChatHasTwoCandidates(t *testing.T) {
	service := New(nil, nil)
	remote := &realmConnection{lease: accountservice.RealmRealtimeAccountLease{AccountID: "account-1", Generation: 1}}
	for index, channelID := range []string{"channel-1", "channel-2"} {
		channel := &realmChannel{
			realtimeSessionID: "realtime-" + channelID,
			channelID:         channelID, accountID: "account-1", accountGeneration: 1, generation: uint64(index + 1),
			subscriptions: make(map[string]*realmSubscription),
		}
		subscription := &realmSubscription{id: "subscription-" + channelID, kind: realmSubscriptionChat, chatID: "chat-1", remoteOpening: true}
		channel.subscriptions[subscription.id] = subscription
		service.channels[channel.channelID] = channel
	}
	if binding := service.findChatSubscription(remote, "early-session", "chat-1"); binding != nil {
		t.Fatalf("ambiguous same-Chat opening selected %s", binding.subscription.id)
	}
	service.channels["channel-1"].subscriptions["subscription-channel-1"].remoteSessionID = "remote-1"
	service.channels["channel-1"].subscriptions["subscription-channel-1"].remoteOpening = false
	if binding := service.findChatSubscription(remote, "remote-1", "chat-1"); binding == nil || binding.subscription.id != "subscription-channel-1" {
		t.Fatalf("exact remote-session binding = %+v", binding)
	}
}

func TestRealmOperationReasonMappingCoversBackendOwnerUnion(t *testing.T) {
	for _, test := range []struct {
		reason string
		code   codes.Code
	}{
		{reason: "CHAT_TARGET_NOT_FOUND", code: codes.NotFound},
		{reason: "CHAT_FORBIDDEN", code: codes.PermissionDenied},
	} {
		if code := status.Code(realmOperationError(wireOperationResult{Status: "error", ReasonCode: test.reason})); code != test.code {
			t.Fatalf("%s code = %v", test.reason, code)
		}
	}
}

func newRealmSubscriptionFixture(t testing.TB, capacity int) (*Service, *realmChannel, *realmSubscription) {
	t.Helper()
	service := New(nil, nil)
	channel := &realmChannel{
		realtimeSessionID: "realtime-session-1", channelID: "channel-1", appID: "app-1", appSessionID: "app-session-1",
		accountID: "account-1", accountGeneration: 1, generation: 1, subscriptions: make(map[string]*realmSubscription),
	}
	stream, err := realtimecore.NewStream[*runtimev1.SubscribeRealmRealtimeEventsResponse](realtimecore.Config{
		RealtimeSessionID: channel.realtimeSessionID, ChannelID: channel.channelID, SubscriptionID: "subscription-1",
		AdapterKind: "realm", Generation: channel.generation, Capacity: capacity, PressureAt: max(1, capacity-1),
	})
	if err != nil {
		t.Fatal(err)
	}
	subscription := &realmSubscription{id: "subscription-1", kind: realmSubscriptionPresence, stream: stream}
	channel.subscriptions[subscription.id] = subscription
	service.channels[channel.channelID] = channel
	return service, channel, subscription
}

type realmListAccountProvider struct {
	lease accountservice.RealmRealtimeAccountLease
}

func (provider realmListAccountProvider) BindRealmRealtimeAccount(context.Context) (accountservice.RealmRealtimeAccountLease, error) {
	return provider.lease, nil
}

func (provider realmListAccountProvider) RefreshRealmRealtimeAccount(context.Context, uint64, string) (accountservice.RealmRealtimeAccountLease, error) {
	return provider.lease, nil
}
