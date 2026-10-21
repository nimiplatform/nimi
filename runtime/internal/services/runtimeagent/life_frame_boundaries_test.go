package runtimeagent

import (
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"strings"
	"testing"
	"time"
)

func TestLifeProposalCannotRegressWithinSameBatch(t *testing.T) {
	l := newAgentLifeState()
	l.Activities["a"] = &lifeActivity{Ref: "a", Title: "Painting", Kind: "project", Phase: lifePaused, Progress: 10}
	before := cloneAgentLifeState(l)
	err := l.acceptFuture([]lifeFrameProposal{{ActivityRef: "a", Title: "Outline", Kind: "project", DurationMinutes: 30, EndProgress: 70}, {ActivityRef: "a", Title: "Paint", Kind: "project", DurationMinutes: 30, EndProgress: 40}}, time.Now(), 1, nil, false)
	if err == nil || !lifeStateEqual(l, before) {
		t.Fatal("invalid batch partially committed or regressed")
	}
}

func TestLifeContextSelectionIsAViewAndMemoryLineageSurvivesCompression(t *testing.T) {
	now := time.Now()
	l := newAgentLifeState()
	read := &lifeConversationRead{AnchorID: "anchor", Revision: 1, FirstSequence: 2}
	l.Activities["a"] = &lifeActivity{Ref: "a", Title: "Blue painting", Kind: "project", Phase: lifeActive, ConversationRead: read, MemoryRefs: []string{"blue"}}
	l.Current = &lifeFrame{ID: "f", ActivityRef: "a", Title: "Blue painting", StartsAt: now, EndsAt: now.Add(time.Hour), Phase: lifeActive, ConversationRead: read, MemoryRefs: []string{"blue"}}
	l.MemoryReadSet = cognitionmemory.MemoryReadSet{BindingRef: "binding", BankRef: "bank", LifecycleRef: "life", Refs: []string{"blue"}}
	l.Explanation = &lifeExplanation{Text: "Compressed preference for blue", ConversationRead: read, MemoryRefs: []string{"blue"}}
	before := cloneAgentLifeState(l)
	excluded := projectLifeContext(l, false, false, &lifeConversationRead{AnchorID: "anchor", Revision: 2, FirstSequence: 3}, now, 1)
	if !strings.Contains(excluded.Core, "Blue painting") || strings.Contains(excluded.Core, `"step":"Blue painting"`) || excluded.Explanation != "" || !lifeStateEqual(l, before) {
		t.Fatal("selection erased life or leaked excluded source")
	}
	restored := projectLifeContext(l, false, false, &lifeConversationRead{AnchorID: "anchor", Revision: 3, FirstSequence: 0}, now, 1)
	if !strings.Contains(restored.Core, "Blue") || len(restored.CoreMemoryReadSet.Refs) != 1 || restored.CoreConversationRead.Revision != 3 {
		t.Fatal("restoration lost provenance")
	}
	l.Explanation = &lifeExplanation{Text: "Second compressed explanation", MemoryRefs: append([]string(nil), restored.CoreMemoryReadSet.Refs...)}
	l.invalidateMemory(map[string]bool{"blue": true}, false)
	if l.Explanation != nil || l.Current == nil || l.Current.ActivityRef != "a" || !l.Current.Invalidated || l.Activities["a"].Title != "Blue painting" {
		t.Fatal("secondary compression washed source or deleted accepted activity")
	}
}

func TestChatBetweenFramesKeepsRecentFactAndTentativeNextStep(t *testing.T) {
	now := time.Now()
	l := newAgentLifeState()
	l.Activities["done"] = &lifeActivity{Ref: "done", Title: "Finished sketch", Kind: "project", Phase: lifeCompleted, Progress: 100}
	l.Activities["next"] = &lifeActivity{Ref: "next", Title: "Later walk", Kind: "routine", Phase: lifePlanned}
	l.Recent = []lifeFrame{{ID: "past", ActivityRef: "done", Title: "Finished sketch", Phase: lifeCompleted, StartsAt: now.Add(-time.Hour), EndsAt: now.Add(-time.Minute)}}
	l.Future = []lifeFrame{{ID: "future", ActivityRef: "next", Title: "Later walk", Phase: lifePlanned, StartsAt: now.Add(time.Hour), EndsAt: now.Add(2 * time.Hour)}}
	view := projectLifeContext(l, false, false, nil, now, 1)
	if view == nil || !strings.Contains(view.Core, `"current":null`) || !strings.Contains(view.Core, "Finished sketch") || !strings.Contains(view.Core, "tentative_future") {
		t.Fatal("chat lost life continuity between frames")
	}
}
