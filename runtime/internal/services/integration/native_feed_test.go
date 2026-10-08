package integration

import (
	"context"
	"encoding/json"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"strings"
	"testing"
	"time"
)

func feedFixture(t *testing.T) (*Service, *nativeFeed, *invocation) {
	t.Helper()
	s := newIntegrationTestService(t, nil)
	call := publicationCall(t, s, testDecision("consumer", 1))
	f := newNativeFeed()
	f.readers = 1
	f.leases[call] = struct{}{}
	f.publish = func(commit func() error) error { return s.commitNativeFeed(f, commit) }
	return s, f, call
}

func TestNativeFeedKeepsExpiryCauseThroughReceiverTeardown(t *testing.T) {
	_, feed, call := feedFixture(t)
	feed.fail(adapterError("INTEGRATION_FEISHU_FRAGMENT_EXPIRED"))
	feed.fail(context.Canceled)
	_, err := feed.read(call.ctx, call.decision, call.target, []string{"user:specified"}, "", time.Second)
	if publicAdapterError(err) != "INTEGRATION_FEISHU_FRAGMENT_EXPIRED" {
		t.Fatal("teardown disguised fragment loss as cancellation", err)
	}
}

func TestNativeFeedBoundsPagesAndIndependentCursors(t *testing.T) {
	_, feed, call := feedFixture(t)
	d, target := call.decision, call.target
	binding := nativeBinding(d, target, []string{"private:1"})
	cursor := feed.cursor(binding, 0)
	body := []byte(`{"text":"` + strings.Repeat("x", nativeEventLimit-32) + `"}`)
	for i := 0; i < 40; i++ {
		if err := feed.Accept(call.ctx, fmt.Sprint(i), "private:1", body); err != nil {
			t.Fatal(err)
		}
	}
	first, err := feed.read(call.ctx, d, target, []string{"private:1"}, cursor, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) > nativePageLimit {
		t.Fatal("page exceeded encoded byte bound")
	}
	var page struct {
		Cursor string
		Events []json.RawMessage
	}
	if json.Unmarshal([]byte(first), &page) != nil || len(page.Events) == 0 || len(page.Events) > 32 {
		t.Fatal("invalid bounded page")
	}
	again, err := feed.read(call.ctx, d, target, []string{"private:1"}, cursor, 0)
	if err != nil || again != first {
		t.Fatal("one read advanced another reader's position")
	}
	next, err := feed.read(call.ctx, d, target, []string{"private:1"}, page.Cursor, 0)
	if err != nil || next == first {
		t.Fatal("next page did not preserve unread events")
	}
	other := d
	other.AccountID = "other-account"
	if _, err := feed.read(call.ctx, other, target, []string{"private:1"}, cursor, 0); err == nil {
		t.Fatal("foreign account cursor admitted")
	}
	if _, err := feed.read(call.ctx, d, target, []string{"group:1"}, cursor, 0); err == nil {
		t.Fatal("filter substitution admitted")
	}
	target.CredentialGeneration++
	if _, err := feed.read(call.ctx, d, target, []string{"private:1"}, cursor, 0); err == nil {
		t.Fatal("generation substitution admitted")
	}
}

func TestNativeFeedAllNewMessagesNormalizesEmptyAndBindsOptionalFilters(t *testing.T) {
	_, feed, call := feedFixture(t)
	cursor := feed.cursor(nativeBinding(call.decision, call.target, nil), feed.next)
	for i, conversation := range []string{"private:1", "private:2"} {
		if err := feed.Accept(call.ctx, fmt.Sprint(i), conversation, []byte(`{"text":"new-message"}`)); err != nil {
			t.Fatal(err)
		}
	}
	all, err := feed.read(call.ctx, call.decision, call.target, nil, cursor, 0)
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Cursor string
		Events []json.RawMessage
	}
	if json.Unmarshal([]byte(all), &page) != nil || len(page.Events) != 2 {
		t.Fatal("unfiltered reader lost a conversation", all)
	}
	if empty, err := feed.read(call.ctx, call.decision, call.target, []string{}, cursor, 0); err != nil || empty != all {
		t.Fatal("omitted and empty views acquired different bindings", err)
	}
	for _, filter := range [][]string{{"private:1"}, {"private:2"}, {"private:1", "private:2"}} {
		if _, err := feed.read(call.ctx, call.decision, call.target, filter, cursor, 0); err == nil {
			t.Fatal("all-message cursor admitted changed filters", filter)
		}
	}
	filteredCursor := feed.cursor(nativeBinding(call.decision, call.target, []string{"private:1"}), 0)
	if _, err := feed.read(call.ctx, call.decision, call.target, nil, filteredCursor, 0); err == nil {
		t.Fatal("filtered cursor widened to all messages")
	}
	other := call.decision
	other.AccountID = "other-account"
	if _, err := feed.read(call.ctx, other, call.target, nil, cursor, 0); err == nil {
		t.Fatal("foreign account acquired all messages")
	}
	changed := call.target
	changed.Public = &runtimev1.IntegrationTarget{TargetRef: "other-target"}
	if _, err := feed.read(call.ctx, call.decision, changed, nil, cursor, 0); err == nil {
		t.Fatal("foreign target reused cursor")
	}
	changed = call.target
	changed.CredentialGeneration++
	if _, err := feed.read(call.ctx, call.decision, changed, nil, cursor, 0); err == nil {
		t.Fatal("old generation reused cursor")
	}
	fresh, err := feed.read(call.ctx, call.decision, call.target, nil, "", 0)
	if err != nil || json.Unmarshal([]byte(fresh), &page) != nil || len(page.Events) != 0 {
		t.Fatal("new explicit reader replayed buffered history", fresh, err)
	}
}

func TestNativeFeedRetentionDedupAndAdmissionBeforeBufferCommit(t *testing.T) {
	s, feed, call := feedFixture(t)
	cursor := feed.cursor(nativeBinding(call.decision, call.target, []string{"private:1"}), 0)
	for i := 0; i < 1001; i++ {
		if err := feed.Accept(call.ctx, fmt.Sprint(i), "private:1", []byte(`{"text":"message"}`)); err != nil {
			t.Fatal(err)
		}
	}
	if len(feed.events) != 1000 || feed.floor != 1 || feed.bytes > nativeFeedByteLimit {
		t.Fatal("retention exceeded")
	}
	if _, err := feed.read(call.ctx, call.decision, call.target, []string{"private:1"}, cursor, 0); err == nil {
		t.Fatal("expired position silently replayed")
	}
	before := feed.next
	if err := feed.Accept(call.ctx, "1000", "private:1", []byte(`{}`)); err != nil || feed.next != before {
		t.Fatal("same provider event duplicated")
	}
	if err := feed.Accept(call.ctx, "oversize", "private:1", []byte(`{"x":"`+strings.Repeat("x", nativeEventLimit)+`"}`)); err == nil {
		t.Fatal("oversized event accepted")
	}
	stopPublication(t, s, call, "revoke", nil)
	if err := feed.Accept(context.Background(), "late", "private:1", []byte(`{"private":"late"}`)); err == nil || feed.next != before {
		t.Fatal("revoked reader authorized buffer/ACK")
	}
	feed.mu.Lock()
	feed.events[0].received = time.Now().Add(-25 * time.Hour)
	feed.pruneLocked(time.Now())
	feed.mu.Unlock()
	if len(feed.events) != 999 {
		t.Fatal("age retention was not applied")
	}
}

func TestNativeFeedKeepsOnlyTheRemainingAdmittedConsumer(t *testing.T) {
	s, feed, first := feedFixture(t)
	second := publicationCall(t, s, testDecision("other-consumer", 1))
	feed.mu.Lock()
	feed.leases[second] = struct{}{}
	feed.readers++
	firstCursor := feed.cursor(nativeBinding(first.decision, first.target, []string{"private:1"}), feed.next)
	secondCursor := feed.cursor(nativeBinding(second.decision, second.target, []string{"private:1"}), feed.next)
	feed.mu.Unlock()
	stopPublication(t, s, first, "revoke", nil)
	if err := feed.Accept(context.Background(), "remaining", "private:1", []byte(`{"text":"remaining-reader"}`)); err != nil {
		t.Fatal("one revoked consumer stopped another admitted reader:", err)
	}
	page, err := feed.read(second.ctx, second.decision, second.target, []string{"private:1"}, secondCursor, 0)
	if err != nil || !strings.Contains(page, "remaining-reader") {
		t.Fatal("remaining consumer lost its independent position", err)
	}
	if shared, err := feed.read(second.ctx, second.decision, second.target, []string{"private:1"}, firstCursor, 0); err != nil || shared != page {
		t.Fatal("an admitted consumer could not reference the same source position", err)
	}
	stopPublication(t, s, second, "revoke", nil)
	before := feed.next
	if err := feed.Accept(context.Background(), "none", "private:1", []byte(`{}`)); err == nil || feed.next != before {
		t.Fatal("buffer accepted data without an admitted reader")
	}
}
