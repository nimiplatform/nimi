package appactivity

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type fakeRegistrations struct {
	mu    sync.Mutex
	facts map[string]SourceFacts
}

func (registrations *fakeRegistrations) ActivitySource(_ context.Context, subject string) (SourceFacts, error) {
	registrations.mu.Lock()
	defer registrations.mu.Unlock()
	return registrations.facts[subject], nil
}

func (registrations *fakeRegistrations) set(subject string, facts SourceFacts) {
	registrations.mu.Lock()
	defer registrations.mu.Unlock()
	registrations.facts[subject] = facts
}

type fakeAgents struct{ facts AgentFacts }

func (agents fakeAgents) ResolveAppActivityAgentTx(_ context.Context, _ *sql.Tx, handle string) (AgentFacts, error) {
	if handle != "agent_ref_valid" {
		return AgentFacts{}, errors.New("denied")
	}
	return agents.facts, nil
}

type testHarness struct {
	t             *testing.T
	service       *Service
	backend       *runtimepersistence.Backend
	registrations *fakeRegistrations
	now           time.Time
	mu            sync.Mutex
}

func newHarness(t *testing.T) *testHarness {
	t.Helper()
	dir := t.TempDir()
	backend, err := runtimepersistence.Open(slog.New(slog.NewTextHandler(io.Discard, nil)), filepath.Join(dir, "local-state.json"))
	if err != nil {
		t.Fatalf("open backend: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	harness := &testHarness{
		t: t, backend: backend, now: time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC),
		registrations: &fakeRegistrations{facts: map[string]SourceFacts{
			"subject-a": {AppID: "nimi.app-a", DisplayName: "App A", Active: true, SourceClass: SourceClassUserImported, LaunchSelector: []byte("rar_v1_handle-a")},
			"subject-b": {AppID: "nimi.app-b", DisplayName: "App B", Active: true, SourceClass: SourceClassLocalDevelopment, LaunchSelector: []byte("01234567890123456789012345678901")},
		}},
	}
	harness.service = New(Options{
		Backend: backend, Registrations: harness.registrations,
		Agents: fakeAgents{facts: AgentFacts{LocalAgentRef: "agent-1", DisplayName: "Mira"}},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: harness.clock,
	})
	t.Cleanup(func() { _ = harness.service.Close() })
	return harness
}

func (harness *testHarness) clock() time.Time {
	harness.mu.Lock()
	defer harness.mu.Unlock()
	return harness.now
}

func (harness *testHarness) advance(duration time.Duration) {
	harness.mu.Lock()
	defer harness.mu.Unlock()
	harness.now = harness.now.Add(duration)
}

func (harness *testHarness) ctx(operation localappop.Operation, account, subject string, session byte) context.Context {
	decision := accountservice.LocalAppCallerDecision{
		AppID: "nimi.test", AccountID: account, RegisteredAppSubject: subject,
		Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: AppAccessDomain,
		ExpiresAt: harness.clock().Add(time.Hour),
	}
	decision.SessionID[0] = session
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
}

func todo(key string, revision uint64, state runtimev1.AppActivityTodoState) *runtimev1.PutAppActivityRequest {
	return &runtimev1.PutAppActivityRequest{
		Key: key, Revision: revision, Kind: runtimev1.AppActivityKind_APP_ACTIVITY_KIND_TODO, TodoState: state,
		Attention: true, Title: "Review draft " + key, ObjectRef: "draft:" + key,
		ActivityType: "com.example.studio.review-requested.v1", DataJson: `{"chapter":"review","words":12}`,
		OccurredAt: timestamppb.New(time.Date(2026, 9, 20, 9, 0, 0, 0, time.UTC)),
	}
}

func (harness *testHarness) put(account, subject string, req *runtimev1.PutAppActivityRequest) *runtimev1.PutAppActivityResponse {
	harness.t.Helper()
	response, err := harness.service.PutAppActivity(harness.ctx(localappop.OperationAppActivityPut, account, subject, 1), req)
	if err != nil {
		harness.t.Fatalf("put %s: %v", req.GetKey(), err)
	}
	return response
}

func reasonOf(err error) codes.Code { return status.Code(err) }

func TestPutIsRevisionedIdempotentAndPublisherPartitioned(t *testing.T) {
	harness := newHarness(t)
	created := harness.put("acct-1", "subject-a", todo("d1", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	if !created.GetChanged() || created.GetRecord().GetSource().GetAppId() != "nimi.app-a" || created.GetRecord().GetUserView().GetNeedsAttention() != true {
		t.Fatalf("unexpected create projection: %+v", created.GetRecord())
	}
	retry := harness.put("acct-1", "subject-a", todo("d1", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	if retry.GetChanged() || retry.GetRecord().GetActivityId() != created.GetRecord().GetActivityId() || retry.GetRecord().GetChangeSeq() != created.GetRecord().GetChangeSeq() {
		t.Fatalf("identical retry must not change: %+v", retry)
	}
	conflicting := todo("d1", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)
	conflicting.Title = "Different"
	if _, err := harness.service.PutAppActivity(harness.ctx(localappop.OperationAppActivityPut, "acct-1", "subject-a", 1), conflicting); reasonOf(err) != codes.Aborted {
		t.Fatalf("same revision different content must conflict, got %v", err)
	}
	updated := harness.put("acct-1", "subject-a", todo("d1", 3, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_COMPLETED))
	if updated.GetRecord().GetActivityId() != created.GetRecord().GetActivityId() || updated.GetRecord().GetTodoState() != runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_COMPLETED ||
		!updated.GetRecord().GetPublishedAt().AsTime().Equal(created.GetRecord().GetPublishedAt().AsTime()) || updated.GetRecord().GetUserView().GetNeedsAttention() {
		t.Fatalf("higher revision must replace projection in place: %+v", updated.GetRecord())
	}
	if _, err := harness.service.PutAppActivity(harness.ctx(localappop.OperationAppActivityPut, "acct-1", "subject-a", 1), todo("d1", 2, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)); reasonOf(err) != codes.Aborted {
		t.Fatalf("stale revision must conflict, got %v", err)
	}
	// Another publisher using the same key never overwrites App A's record.
	other := harness.put("acct-1", "subject-b", todo("d1", 9, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	if other.GetRecord().GetActivityId() == created.GetRecord().GetActivityId() || other.GetRecord().GetSource().GetSourceRef() == created.GetRecord().GetSource().GetSourceRef() {
		t.Fatalf("publisher partitions must be isolated")
	}
	// Another account never sees or overwrites App A's record.
	list, err := harness.service.ListAppActivities(harness.ctx(localappop.OperationAppActivityList, "acct-2", "subject-a", 2), &runtimev1.ListAppActivitiesRequest{})
	if err != nil || len(list.GetRecords()) != 0 {
		t.Fatalf("other account must not read records: %v %d", err, len(list.GetRecords()))
	}
}

func TestPutRejectsInvalidPublication(t *testing.T) {
	harness := newHarness(t)
	ctx := harness.ctx(localappop.OperationAppActivityPut, "acct-1", "subject-a", 1)
	cases := map[string]func(*runtimev1.PutAppActivityRequest){
		"todo without object": func(req *runtimev1.PutAppActivityRequest) { req.ObjectRef = "" },
		"path object":         func(req *runtimev1.PutAppActivityRequest) { req.ObjectRef = "/Users/me/file.txt" },
		"url object":          func(req *runtimev1.PutAppActivityRequest) { req.ObjectRef = "https://example.com" },
		"runtime type": func(req *runtimev1.PutAppActivityRequest) {
			req.ActivityType = "nimi.runtime.agent-conversation.turn-completed.v1"
		},
		"unversioned type": func(req *runtimev1.PutAppActivityRequest) { req.ActivityType = "com.example.review" },
		"array data":       func(req *runtimev1.PutAppActivityRequest) { req.DataJson = `[1,2]` },
		"control title":    func(req *runtimev1.PutAppActivityRequest) { req.Title = "bad\x00title" },
		"activity with state": func(req *runtimev1.PutAppActivityRequest) {
			req.Kind = runtimev1.AppActivityKind_APP_ACTIVITY_KIND_ACTIVITY
		},
		"missing occurred": func(req *runtimev1.PutAppActivityRequest) { req.OccurredAt = nil },
		"far future occurred": func(req *runtimev1.PutAppActivityRequest) {
			req.OccurredAt = timestamppb.New(harness.clock().Add(72 * time.Hour))
		},
		"zero revision":        func(req *runtimev1.PutAppActivityRequest) { req.Revision = 0 },
		"unknown agent handle": func(req *runtimev1.PutAppActivityRequest) { req.AgentHandle = "agent_ref_other" },
	}
	for name, mutate := range cases {
		req := todo("bad", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)
		mutate(req)
		if _, err := harness.service.PutAppActivity(ctx, req); err == nil {
			t.Fatalf("%s: expected rejection", name)
		}
	}
	large := todo("large", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)
	large.DataJson = fmt.Sprintf(`{"blob":%q}`, string(make([]byte, MaxDataJSONBytes)))
	if _, err := harness.service.PutAppActivity(ctx, large); err == nil {
		t.Fatalf("oversized data must be rejected")
	}
	// A kind change for an existing key is rejected.
	harness.put("acct-1", "subject-a", todo("kinded", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	activity := todo("kinded", 2, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_UNSPECIFIED)
	activity.Kind = runtimev1.AppActivityKind_APP_ACTIVITY_KIND_ACTIVITY
	if _, err := harness.service.PutAppActivity(ctx, activity); reasonOf(err) != codes.InvalidArgument {
		t.Fatalf("kind change must be invalid, got %v", err)
	}
	// Wrong operation in the admitted decision never reaches the owner.
	if _, err := harness.service.PutAppActivity(harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-a", 1), todo("x", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)); reasonOf(err) != codes.PermissionDenied {
		t.Fatalf("mismatched admission must be denied, got %v", err)
	}
}

type fakeChangeStream struct {
	grpc.ServerStream
	ctx    context.Context
	mu     sync.Mutex
	events []*runtimev1.SubscribeAppActivityChangesResponse
	notify chan struct{}
}

func newFakeChangeStream(ctx context.Context) *fakeChangeStream {
	return &fakeChangeStream{ctx: ctx, notify: make(chan struct{}, 1024)}
}

func (stream *fakeChangeStream) Context() context.Context { return stream.ctx }

func (stream *fakeChangeStream) Send(event *runtimev1.SubscribeAppActivityChangesResponse) error {
	stream.mu.Lock()
	stream.events = append(stream.events, event)
	stream.mu.Unlock()
	stream.notify <- struct{}{}
	return nil
}

func (stream *fakeChangeStream) waitFor(t *testing.T, count int) []*runtimev1.SubscribeAppActivityChangesResponse {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		stream.mu.Lock()
		if len(stream.events) >= count {
			events := append([]*runtimev1.SubscribeAppActivityChangesResponse(nil), stream.events...)
			stream.mu.Unlock()
			return events
		}
		stream.mu.Unlock()
		select {
		case <-stream.notify:
		case <-deadline:
			t.Fatalf("timed out waiting for %d events", count)
		}
	}
}

func (harness *testHarness) subscribe(account string, after uint64) (*fakeChangeStream, context.CancelFunc, chan error) {
	ctx, cancel := context.WithCancel(harness.ctx(localappop.OperationAppActivitySubscribe, account, "subject-b", 2))
	stream := newFakeChangeStream(ctx)
	done := make(chan error, 1)
	go func() {
		done <- harness.service.SubscribeAppActivityChanges(&runtimev1.SubscribeAppActivityChangesRequest{AfterChangeSeq: after}, stream)
	}()
	return stream, cancel, done
}

func (harness *testHarness) expectExpired(account string, after uint64) error {
	_, cancel, done := harness.subscribe(account, after)
	defer cancel()
	select {
	case err := <-done:
		if reasonOf(err) != codes.OutOfRange {
			return fmt.Errorf("unexpected result %v", err)
		}
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("subscription did not report an expired cursor")
	}
}

func TestListingAcrossPagesKeepsBaselineAndSubscriptionClosesTheGap(t *testing.T) {
	harness := newHarness(t)
	for index := 1; index <= 101; index++ {
		harness.put("acct-1", "subject-a", todo(fmt.Sprintf("k%03d", index), 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	}
	listCtx := harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-b", 2)
	filter := &runtimev1.AppActivityFilter{
		Kind:       runtimev1.AppActivityKind_APP_ACTIVITY_KIND_TODO,
		TodoStates: []runtimev1.AppActivityTodoState{runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN},
	}
	first, err := harness.service.ListAppActivities(listCtx, &runtimev1.ListAppActivitiesRequest{Filter: filter, PageSize: 100})
	if err != nil || len(first.GetRecords()) != 100 || first.GetNextPageToken() == "" || first.GetBaselineChangeSeq() != 101 {
		t.Fatalf("first page: err=%v len=%d token=%q baseline=%d", err, len(first.GetRecords()), first.GetNextPageToken(), first.GetBaselineChangeSeq())
	}
	// After the baseline: one scanned record completes, one new record appears.
	completedKey := first.GetRecords()[0].GetKey()
	harness.put("acct-1", "subject-a", todo(completedKey, 2, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_COMPLETED))
	harness.put("acct-1", "subject-a", todo("k102", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	second, err := harness.service.ListAppActivities(listCtx, &runtimev1.ListAppActivitiesRequest{Filter: filter, PageSize: 100, PageToken: first.GetNextPageToken()})
	if err != nil || len(second.GetRecords()) != 1 || second.GetNextPageToken() != "" || second.GetBaselineChangeSeq() != 101 {
		t.Fatalf("second page must hold only the 101st record: err=%v len=%d", err, len(second.GetRecords()))
	}
	if second.GetRecords()[0].GetKey() != "k001" {
		t.Fatalf("keyset continuation must not skip or repeat records, got %s", second.GetRecords()[0].GetKey())
	}
	// A continuation with a different filter is rejected.
	if _, err := harness.service.ListAppActivities(listCtx, &runtimev1.ListAppActivitiesRequest{PageToken: first.GetNextPageToken()}); reasonOf(err) != codes.InvalidArgument {
		t.Fatalf("filter mismatch must invalidate token, got %v", err)
	}
	// A continuation cannot carry a listing across an account change.
	otherAccount := harness.ctx(localappop.OperationAppActivityList, "acct-2", "subject-b", 3)
	if _, err := harness.service.ListAppActivities(otherAccount, &runtimev1.ListAppActivitiesRequest{Filter: filter, PageSize: 100, PageToken: first.GetNextPageToken()}); reasonOf(err) != codes.InvalidArgument {
		t.Fatalf("another account must reject the continuation, got %v", err)
	}
	stream, cancel, done := harness.subscribe("acct-1", first.GetBaselineChangeSeq())
	events := stream.waitFor(t, 2)
	cancel()
	<-done
	if events[0].GetChangeSeq() != 102 || events[0].GetRecord().GetKey() != completedKey ||
		events[0].GetRecord().GetTodoState() != runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_COMPLETED {
		t.Fatalf("subscription must deliver the post-baseline completion first: %+v", events[0])
	}
	if events[1].GetChangeSeq() != 103 || events[1].GetRecord().GetKey() != "k102" {
		t.Fatalf("subscription must deliver the post-baseline creation: %+v", events[1])
	}
}

func TestMarkReadIsMonotonicAndSeparateFromBusinessState(t *testing.T) {
	harness := newHarness(t)
	created := harness.put("acct-1", "subject-a", todo("r", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	for revision := uint64(2); revision <= 5; revision++ {
		harness.put("acct-1", "subject-a", todo("r", revision, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	}
	homeCtx := harness.ctx(localappop.OperationAppActivityMarkRead, "acct-1", "subject-home", 3)
	appBCtx := harness.ctx(localappop.OperationAppActivityMarkRead, "acct-1", "subject-b", 2)
	read5, err := harness.service.MarkAppActivityRead(homeCtx, &runtimev1.MarkAppActivityReadRequest{ActivityId: created.GetRecord().GetActivityId(), DisplayedRevision: 5})
	if err != nil || read5.GetRecord().GetUserView().GetReadThroughRevision() != 5 || read5.GetRecord().GetUserView().GetUnread() ||
		read5.GetRecord().GetTodoState() != runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN {
		t.Fatalf("read r5 must mark read without completing: %v %+v", err, read5.GetRecord())
	}
	late, err := harness.service.MarkAppActivityRead(appBCtx, &runtimev1.MarkAppActivityReadRequest{ActivityId: created.GetRecord().GetActivityId(), DisplayedRevision: 4})
	if err != nil || late.GetRecord().GetUserView().GetReadThroughRevision() != 5 || late.GetRecord().GetChangeSeq() != read5.GetRecord().GetChangeSeq() {
		t.Fatalf("late r4 must not regress or emit a change: %v %+v", err, late.GetRecord())
	}
	if _, err := harness.service.MarkAppActivityRead(appBCtx, &runtimev1.MarkAppActivityReadRequest{ActivityId: created.GetRecord().GetActivityId(), DisplayedRevision: 6}); reasonOf(err) != codes.InvalidArgument {
		t.Fatalf("revision above current must be rejected, got %v", err)
	}
	updated := harness.put("acct-1", "subject-a", todo("r", 6, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	if !updated.GetRecord().GetUserView().GetUnread() || updated.GetRecord().GetUserView().GetReadThroughRevision() != 5 {
		t.Fatalf("an unseen update must stay unread: %+v", updated.GetRecord().GetUserView())
	}
	silent := todo("r", 7, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)
	silent.Attention = false
	silentRecord := harness.put("acct-1", "subject-a", silent)
	if !silentRecord.GetRecord().GetUserView().GetUnread() || silentRecord.GetRecord().GetUserView().GetNeedsAttention() {
		t.Fatalf("attention=false stays unread but needs no reminder: %+v", silentRecord.GetRecord().GetUserView())
	}
}

func TestSubscriptionReplaysInOrderAndExpiresPurgedCursors(t *testing.T) {
	harness := newHarness(t)
	a := harness.put("acct-1", "subject-a", todo("a", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	harness.put("acct-1", "subject-b", todo("b", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	harness.put("acct-1", "subject-a", todo("a", 2, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_COMPLETED))
	stream, cancel, done := harness.subscribe("acct-1", 0)
	events := stream.waitFor(t, 3)
	cancel()
	<-done
	// Replay never collapses A's first change into its later snapshot.
	if events[0].GetChangeSeq() != 1 || events[0].GetRecord().GetRevision() != 1 || events[1].GetChangeSeq() != 2 || events[2].GetRecord().GetRevision() != 2 {
		t.Fatalf("replay must deliver each committed image in order: %+v", events)
	}
	// Retention of the terminal todo and old changes advances the floor.
	harness.advance(RetentionWindow + time.Hour)
	if err := harness.service.RunRetention(context.Background()); err != nil {
		t.Fatalf("retention: %v", err)
	}
	if err := harness.expectExpired("acct-1", 1); err != nil {
		t.Fatalf("cursor below the replay floor must expire: %v", err)
	}
	list, err := harness.service.ListAppActivities(harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-b", 2), &runtimev1.ListAppActivitiesRequest{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, record := range list.GetRecords() {
		if record.GetActivityId() == a.GetRecord().GetActivityId() {
			t.Fatalf("retained terminal todo past the window must be removed")
		}
	}
	if len(list.GetRecords()) != 1 {
		t.Fatalf("open todo of an available source stays retained, got %d", len(list.GetRecords()))
	}
	fresh, cancelFresh, freshDone := harness.subscribe("acct-1", list.GetBaselineChangeSeq())
	harness.put("acct-1", "subject-b", todo("b", 2, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN))
	fresh.waitFor(t, 1)
	cancelFresh()
	<-freshDone
}

func TestAgentAndAccountCleanupRemoveRuntimeOriginActivity(t *testing.T) {
	harness := newHarness(t)
	appRecord := todo("with-agent", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)
	appRecord.AgentHandle = "agent_ref_valid"
	withAgent := harness.put("acct-1", "subject-a", appRecord)
	if withAgent.GetRecord().GetAgent().GetDisplayName() != "Mira" || withAgent.GetRecord().GetAgent().GetAgentRef() == "" {
		t.Fatalf("resolved Agent association must project a display reference: %+v", withAgent.GetRecord().GetAgent())
	}
	var published bool
	err := harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		var err error
		published, err = PublishRuntimeAgentTurnTx(context.Background(), tx, RuntimeAgentTurn{
			AccountID: "acct-1", LocalAgentRef: "agent-1", AgentDisplayName: "Mira", TurnID: "turn-1", CommittedAt: harness.clock(),
		})
		return err
	})
	if err != nil || !published {
		t.Fatalf("publish Runtime turn: %v %v", err, published)
	}
	_ = harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		again, err := PublishRuntimeAgentTurnTx(context.Background(), tx, RuntimeAgentTurn{
			AccountID: "acct-1", LocalAgentRef: "agent-1", AgentDisplayName: "Mira", TurnID: "turn-1", CommittedAt: harness.clock(),
		})
		if err != nil || again {
			t.Fatalf("republication of a committed turn must be idempotent: %v %v", err, again)
		}
		return nil
	})
	list, _ := harness.service.ListAppActivities(harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-b", 2), &runtimev1.ListAppActivitiesRequest{})
	var runtimeRecord *runtimev1.AppActivityRecord
	for _, record := range list.GetRecords() {
		if record.GetSource().GetKind() == runtimev1.AppActivitySourceKind_APP_ACTIVITY_SOURCE_KIND_RUNTIME_AGENT {
			runtimeRecord = record
		}
	}
	if runtimeRecord == nil || runtimeRecord.GetObjectRef() != "" || runtimeRecord.GetActivityType() != RuntimeAgentTurnActivityType || runtimeRecord.GetAgent().GetDisplayName() != "Mira" {
		t.Fatalf("Runtime-origin record must be a fixed read-only summary: %+v", runtimeRecord)
	}
	oldCursor := uint64(1)
	if err := harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := RemoveAgentActivityTx(context.Background(), tx, "agent-1", harness.clock())
		return err
	}); err != nil {
		t.Fatalf("remove Agent activity: %v", err)
	}
	after, _ := harness.service.ListAppActivities(harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-b", 2), &runtimev1.ListAppActivitiesRequest{})
	if len(after.GetRecords()) != 1 || after.GetRecords()[0].GetAgent() != nil || after.GetRecords()[0].GetActivityId() != withAgent.GetRecord().GetActivityId() {
		t.Fatalf("App record must remain with its Agent association cleared: %+v", after.GetRecords())
	}
	if err := harness.expectExpired("acct-1", oldCursor); err != nil {
		t.Fatalf("cursor needing purged Runtime payloads must expire: %v", err)
	}
	stream, cancel, done := harness.subscribe("acct-1", runtimeRecord.GetChangeSeq())
	events := stream.waitFor(t, 2)
	cancel()
	<-done
	var sawRemove, sawCleared bool
	for _, event := range events {
		switch {
		case event.GetKind() == runtimev1.AppActivityChangeKind_APP_ACTIVITY_CHANGE_KIND_REMOVE:
			sawRemove = event.GetRecord() == nil && event.GetActivityId() == runtimeRecord.GetActivityId()
		case event.GetActivityId() == withAgent.GetRecord().GetActivityId():
			sawCleared = event.GetRecord().GetAgent() == nil
		}
	}
	if !sawRemove || !sawCleared {
		t.Fatalf("online consumers must receive a content-free remove and the cleared association: %+v", events)
	}
	if err := harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		return RemoveAccountActivityTx(context.Background(), tx, "acct-1")
	}); err != nil {
		t.Fatalf("remove Account activity: %v", err)
	}
	empty, _ := harness.service.ListAppActivities(harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-b", 2), &runtimev1.ListAppActivitiesRequest{})
	if len(empty.GetRecords()) != 0 || empty.GetBaselineChangeSeq() != 0 {
		t.Fatalf("Account-terminal cleanup must remove the partition")
	}
}

func TestAgentCleanupPurgesPayloadsOfRetentionRemovedRecords(t *testing.T) {
	harness := newHarness(t)
	if err := harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := PublishRuntimeAgentTurnTx(context.Background(), tx, RuntimeAgentTurn{
			AccountID: "acct-1", LocalAgentRef: "agent-1", AgentDisplayName: "Mira", TurnID: "turn-1", CommittedAt: harness.clock(),
		})
		return err
	}); err != nil {
		t.Fatalf("publish Runtime turn: %v", err)
	}
	list, _ := harness.service.ListAppActivities(harness.ctx(localappop.OperationAppActivityList, "acct-1", "subject-b", 2), &runtimev1.ListAppActivitiesRequest{})
	if len(list.GetRecords()) != 1 {
		t.Fatalf("expected the Runtime-origin record, got %d", len(list.GetRecords()))
	}
	turn := list.GetRecords()[0]
	// Day 29: reading it retains a newer payload with the Agent association.
	harness.advance(29 * 24 * time.Hour)
	read, err := harness.service.MarkAppActivityRead(harness.ctx(localappop.OperationAppActivityMarkRead, "acct-1", "subject-b", 2),
		&runtimev1.MarkAppActivityReadRequest{ActivityId: turn.GetActivityId(), DisplayedRevision: 1})
	if err != nil || read.GetRecord().GetChangeSeq() != 2 {
		t.Fatalf("mark read: %v %+v", err, read.GetRecord())
	}
	// Day 31: retention removes the record and the day-0 payload only.
	harness.advance(2 * 24 * time.Hour)
	if err := harness.service.RunRetention(context.Background()); err != nil {
		t.Fatalf("retention: %v", err)
	}
	payloads := func() int {
		var count int
		if err := harness.backend.DB().QueryRow(
			`SELECT COUNT(*) FROM runtime_app_activity_change WHERE account_id = 'acct-1' AND record_json LIKE '%Mira%'`).Scan(&count); err != nil {
			t.Fatalf("count payloads: %v", err)
		}
		return count
	}
	if payloads() != 1 {
		t.Fatalf("precondition: the day-29 payload outlives its retention-removed record")
	}
	if err := harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		accounts, err := RemoveAgentActivityTx(context.Background(), tx, "agent-1", harness.clock())
		if err == nil && (len(accounts) != 1 || accounts[0] != "acct-1") {
			t.Errorf("the purged account must be reported for notification: %v", accounts)
		}
		return err
	}); err != nil {
		t.Fatalf("remove Agent activity: %v", err)
	}
	if remaining := payloads(); remaining != 0 {
		t.Fatalf("Agent termination must purge every retained payload, %d remain", remaining)
	}
	if err := harness.expectExpired("acct-1", 1); err != nil {
		t.Fatalf("a cursor that would replay the purged payload must expire: %v", err)
	}
	stream, cancel, done := harness.subscribe("acct-1", 2)
	events := stream.waitFor(t, 1)
	cancel()
	<-done
	if len(events) != 1 || events[0].GetKind() != runtimev1.AppActivityChangeKind_APP_ACTIVITY_CHANGE_KIND_REMOVE || events[0].GetRecord() != nil {
		t.Fatalf("only the content-free remove stays replayable: %+v", events)
	}
}

func TestPublicationIsRejectedForFencedAccount(t *testing.T) {
	harness := newHarness(t)
	if err := harness.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_realm_account_termination(account_id, operation_id, deleted_at, phase, created_at, updated_at) VALUES('acct-9', 'op-9', 'x', 'fenced', 'x', 'x')`)
		return err
	}); err != nil {
		t.Fatalf("fence: %v", err)
	}
	if _, err := harness.service.PutAppActivity(harness.ctx(localappop.OperationAppActivityPut, "acct-9", "subject-a", 1), todo("f", 1, runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN)); reasonOf(err) != codes.FailedPrecondition {
		t.Fatalf("fenced account must reject publication, got %v", err)
	}
}
