package runtimeagent

import (
	"strings"
	"testing"
	"time"
)

func TestConversationSummaryUnavailableAttemptSurvivesRepeatedPersistenceFailure(t *testing.T) {
	testCases := []struct {
		name         string
		turns        [][2]string
		targetEnd    uint64
		initial      *publicChatConversationSummaryState
		wantValid    bool
		wantRevision uint64
	}{
		{
			name: "without prior valid summary",
			turns: [][2]string{
				{"user 0", "assistant 0"}, {"user 1", "assistant 1"},
				{"user 2", "assistant 2"}, {"user 3", "assistant 3"},
				{"user 4", "assistant 4"}, {"user 5", "assistant 5"},
				{"user 6", "assistant 6"},
			},
			targetEnd: 0,
		},
		{
			name: "with prior valid summary",
			turns: [][2]string{
				{"user 0", "assistant 0"}, {"user 1", "assistant 1"},
				{"user 2", "assistant 2"}, {"user 3", "assistant 3"},
				{"user 4", "assistant 4"}, {"user 5", "assistant 5"},
				{"user 6", "assistant 6"}, {"user 7", "assistant 7"},
			},
			targetEnd: 1,
			initial: &publicChatConversationSummaryState{
				LastValid: &publicChatConversationSummaryValidState{
					Revision: 3, CoveredSequenceStart: 0, CoveredSequenceEnd: 0,
					Text: "last valid summary", GeneratedAt: time.Now().UTC(),
					RouteCorrelation: strings.Repeat("a", 64),
				},
				LastAttempt: publicChatConversationSummaryAttemptState{
					Status: "ready", TargetSequenceEnd: 0, AttemptedAt: time.Now().UTC(),
				},
			},
			wantValid: true, wantRevision: 3,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			statePath := t.TempDir() + "/runtime-state.json"
			svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
			defer closeSvc()
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")

			svc.chatSurfaceMu.Lock()
			anchor := svc.chatAnchors[anchorID]
			anchor.CommittedTranscript = testPublicChatCommittedTranscript(testCase.turns...)
			anchor.ConversationSummary = clonePublicChatConversationSummary(testCase.initial)
			if err := svc.persistPublicChatSurfaceStateLocked(); err != nil {
				svc.chatSurfaceMu.Unlock()
				t.Fatalf("persist baseline summary state: %v", err)
			}
			versionBefore := svc.chatSurfaceVersion
			svc.chatSurfaceMu.Unlock()

			if _, err := svc.backend.DB().Exec(`
				CREATE TRIGGER runtime_test_reject_conversation_summary_commit
				BEFORE UPDATE OF value ON runtime_local_agent_meta
				WHEN OLD.key = 'public_chat_surface_state'
				BEGIN
					SELECT RAISE(FAIL, 'injected conversation summary persistence failure');
				END
			`); err != nil {
				t.Fatalf("create summary persistence trigger: %v", err)
			}
			defer func() {
				if _, err := svc.backend.DB().Exec(`DROP TRIGGER IF EXISTS runtime_test_reject_conversation_summary_commit`); err != nil {
					t.Errorf("drop summary persistence trigger: %v", err)
				}
			}()

			if err := svc.commitPublicChatConversationSummary(
				anchorID,
				testCase.targetEnd,
				"replacement summary",
				strings.Repeat("b", 64),
			); err == nil {
				t.Fatal("summary payload persistence failure returned success")
			}
			if err := svc.commitPublicChatConversationSummaryAttempt(anchorID, testCase.targetEnd, "unavailable"); err == nil {
				t.Fatal("summary attempt persistence failure returned success")
			}

			svc.chatSurfaceMu.Lock()
			state := clonePublicChatConversationSummary(svc.chatAnchors[anchorID].ConversationSummary)
			versionAfter := svc.chatSurfaceVersion
			svc.chatSurfaceMu.Unlock()
			if state == nil || state.LastAttempt.Status != "unavailable" || state.LastAttempt.TargetSequenceEnd != testCase.targetEnd || state.LastAttempt.AttemptedAt.IsZero() {
				t.Fatalf("in-memory typed unavailable attempt = %#v", state)
			}
			if (state.LastValid != nil) != testCase.wantValid {
				t.Fatalf("last valid presence = %#v, want %v", state.LastValid, testCase.wantValid)
			}
			if state.LastValid != nil && (state.LastValid.Revision != testCase.wantRevision || state.LastValid.Text != "last valid summary" || state.LastValid.CoveredSequenceEnd != 0) {
				t.Fatalf("last valid summary changed after persistence failure: %#v", state.LastValid)
			}
			if versionAfter != versionBefore {
				t.Fatalf("failed persistence advanced durable version bookkeeping: before=%d after=%d", versionBefore, versionAfter)
			}
		})
	}
}
