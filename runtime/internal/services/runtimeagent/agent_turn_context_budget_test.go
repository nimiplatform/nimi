package runtimeagent

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestAgentTurnContextProviderSequenceUsesFixedLaneOrder(t *testing.T) {
	t.Parallel()
	compiled, err := compileAgentTurnContext(agentTurnContextTestInput(t, "worldCharacter"))
	if err != nil {
		t.Fatal(err)
	}
	if len(compiled.ProviderPrompt.Messages) == 0 {
		t.Fatal("provider prompt is empty")
	}
	positions := make(map[agentTurnContextLaneID]int)
	for index, message := range compiled.ProviderPrompt.Messages {
		for _, laneID := range agentTurnContextFixedLaneOrder {
			if strings.Contains(message.Content, "lane="+string(laneID)+"\n") {
				if _, exists := positions[laneID]; !exists {
					positions[laneID] = index
				}
			}
		}
	}
	for _, laneID := range []agentTurnContextLaneID{
		agentTurnContextLaneRuntimePolicy,
		agentTurnContextLaneOutputContract,
		agentTurnContextLaneSourceIdentity,
		agentTurnContextLaneSourceBehavior,
		agentTurnContextLaneWorldContext,
		agentTurnContextLaneRelationshipContext,
		agentTurnContextLaneSourceKnowledge,
		agentTurnContextLaneCanonicalMemory,
		agentTurnContextLaneCapabilityContext,
	} {
		if _, ok := positions[laneID]; !ok {
			t.Fatalf("provider prompt is missing lane %s", laneID)
		}
	}
	orderedSystemLanes := []agentTurnContextLaneID{
		agentTurnContextLaneRuntimePolicy,
		agentTurnContextLaneOutputContract,
		agentTurnContextLaneSourceIdentity,
		agentTurnContextLaneSourceBehavior,
		agentTurnContextLaneWorldContext,
		agentTurnContextLaneRelationshipContext,
		agentTurnContextLaneSourceKnowledge,
		agentTurnContextLaneCanonicalMemory,
	}
	for index := 1; index < len(orderedSystemLanes); index++ {
		if positions[orderedSystemLanes[index-1]] >= positions[orderedSystemLanes[index]] {
			t.Fatalf("provider lane %s was not after %s", orderedSystemLanes[index], orderedSystemLanes[index-1])
		}
	}
	var historyAssistantIndex = -1
	var currentUserIndex = -1
	for index, message := range compiled.ProviderPrompt.Messages {
		if message.Role == "assistant" && message.Content == "This is the canonical fixture world." {
			historyAssistantIndex = index
		}
		if message.Role == "user" && message.Content == "Continue from our prior conversation." {
			currentUserIndex = index
		}
	}
	if historyAssistantIndex < 0 || currentUserIndex < 0 || positions[agentTurnContextLaneCapabilityContext] <= historyAssistantIndex || currentUserIndex <= positions[agentTurnContextLaneCapabilityContext] || currentUserIndex != len(compiled.ProviderPrompt.Messages)-1 {
		t.Fatalf("provider history/capability/current order is invalid: history=%d capability=%d current=%d total=%d", historyAssistantIndex, positions[agentTurnContextLaneCapabilityContext], currentUserIndex, len(compiled.ProviderPrompt.Messages))
	}
}

func TestAgentTurnContextBudgetTruncatesWholeItemsInFixedOrder(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.Transcript[0].UserText = "old-user-canary-" + strings.Repeat("A", 800)
	input.Transcript[0].AssistantText = "old-assistant-canary-" + strings.Repeat("B", 800)
	input.Transcript[1].UserText = "new-user-canary-" + strings.Repeat("C", 800)
	input.Transcript[1].AssistantText = "new-assistant-canary-" + strings.Repeat("D", 800)
	input.Memory[0].Text = "high-memory-canary-" + strings.Repeat("H", 800)
	input.Memory[1].Text = "low-memory-canary-" + strings.Repeat("L", 800)
	full, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	history := agentTurnContextTestLane(t, full.PrivateLanes, agentTurnContextLaneConversationHistory)
	memory := agentTurnContextTestLane(t, full.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	if len(history.Items) != 2 || len(memory.Items) != 2 {
		t.Fatalf("history=%d memory=%d", len(history.Items), len(memory.Items))
	}
	reserved := input.Budget.ReservedOutputTokens + input.Budget.ReservedSafetyTokens + input.Budget.ReservedAdapterTokens
	input.Budget.ContextWindowTokens = reserved + full.Manifest.Budget.UsedTokens - history.Items[0].TokenEstimate
	trimOldest, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	trimmedHistory := agentTurnContextTestLane(t, trimOldest.PrivateLanes, agentTurnContextLaneConversationHistory)
	trimmedMemory := agentTurnContextTestLane(t, trimOldest.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	if trimmedHistory.Items[0].Included || !trimmedHistory.Items[0].Truncated || !trimmedHistory.Items[1].Included {
		t.Fatalf("oldest complete pair was not removed first: %+v", trimmedHistory.Items)
	}
	if !trimmedMemory.Items[0].Included || !trimmedMemory.Items[1].Included {
		t.Fatalf("memory was truncated before history: %+v", trimmedMemory.Items)
	}
	providerText := agentTurnContextTestProviderText(trimOldest.ProviderPrompt)
	if strings.Contains(providerText, "old-user-canary") || strings.Contains(providerText, "old-assistant-canary") || !strings.Contains(providerText, "new-user-canary") || !strings.Contains(providerText, "new-assistant-canary") {
		t.Fatal("history pair was fragmented or the wrong pair was removed")
	}

	historyTokens := history.Items[0].TokenEstimate + history.Items[1].TokenEstimate
	lowMemoryTokens := memory.Items[1].TokenEstimate
	input.Budget.ContextWindowTokens = reserved + full.Manifest.Budget.UsedTokens - historyTokens - lowMemoryTokens
	trimMemory, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	trimmedHistory = agentTurnContextTestLane(t, trimMemory.PrivateLanes, agentTurnContextLaneConversationHistory)
	trimmedMemory = agentTurnContextTestLane(t, trimMemory.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	if trimmedHistory.TruncatedCount != 2 || trimmedMemory.TruncatedCount != 1 || !trimmedMemory.Items[0].Included || trimmedMemory.Items[1].Included {
		t.Fatalf("fixed history->low-memory truncation failed: history=%+v memory=%+v", trimmedHistory, trimmedMemory)
	}
	providerText = agentTurnContextTestProviderText(trimMemory.ProviderPrompt)
	if strings.Contains(providerText, "low-memory-canary") || !strings.Contains(providerText, "high-memory-canary") {
		t.Fatal("memory truncation did not remove the whole lowest-ranked item")
	}
	if trimMemory.Summary.GetTruncation()[0].GetReason().String() != "AGENT_TURN_CONTEXT_TRUNCATION_REASON_INPUT_BUDGET_EXHAUSTED" {
		t.Fatalf("truncation reason=%s", trimMemory.Summary.GetTruncation()[0].GetReason())
	}
}

func TestAgentTurnContextMandatoryOverflowFailsClosedWithTypedSummary(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "realmPersona")
	full, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	reserved := input.Budget.ReservedOutputTokens + input.Budget.ReservedSafetyTokens + input.Budget.ReservedAdapterTokens
	if full.Manifest.Budget.RequiredTokens == 0 {
		t.Fatal("fixture has no mandatory context")
	}
	input.Budget.ContextWindowTokens = reserved + full.Manifest.Budget.RequiredTokens - 1
	compiled, err := compileAgentTurnContext(input)
	if compiled != nil {
		t.Fatal("capacity overflow returned a provider compilation")
	}
	var capacity *agentTurnContextCapacityExceededError
	if !errors.As(err, &capacity) {
		t.Fatalf("overflow error=%T %v", err, err)
	}
	if capacity.RequiredTokens != full.Manifest.Budget.RequiredTokens || capacity.AvailableTokens != full.Manifest.Budget.RequiredTokens-1 || capacity.BlockingLane == "" {
		t.Fatalf("typed capacity error=%+v", capacity)
	}
	if capacity.Summary == nil || capacity.Summary.GetReady() || capacity.Summary.GetState().String() != "AGENT_TURN_CONTEXT_STATE_CONTEXT_CAPACITY_EXCEEDED" || capacity.Summary.GetReasonCode().String() != "AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_CAPACITY_EXCEEDED" || capacity.Summary.GetPromptHash() != "" {
		t.Fatalf("capacity summary=%+v", capacity.Summary)
	}
}

func TestAgentTurnContextWindowBelowReservationsFailsWithZeroAvailableCapacity(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	reserved := input.Budget.ReservedOutputTokens + input.Budget.ReservedSafetyTokens + input.Budget.ReservedAdapterTokens
	if reserved == 0 {
		t.Fatal("fixture has no reserved capacity")
	}
	input.Budget.ContextWindowTokens = reserved - 1
	compiled, err := compileAgentTurnContext(input)
	if compiled != nil {
		t.Fatal("window below reservations returned a provider compilation")
	}
	var capacity *agentTurnContextCapacityExceededError
	if !errors.As(err, &capacity) {
		t.Fatalf("below-reservations error=%T %v", err, err)
	}
	if capacity.RequiredTokens == 0 || capacity.AvailableTokens != 0 || capacity.BlockingLane == "" {
		t.Fatalf("typed zero-capacity error=%+v", capacity)
	}
	if capacity.Summary == nil || capacity.Summary.GetReady() || capacity.Summary.GetBudget().GetInputBudgetTokens() != 0 || capacity.Summary.GetPromptHash() != "" {
		t.Fatalf("zero-capacity summary=%+v", capacity.Summary)
	}
}

func TestAgentTurnContextTokenUpperBoundUsesFinalProviderVisibleUTF8Bytes(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name    string
		content string
	}{
		{name: "cjk", content: strings.Repeat("世界人格关系知识", 32)},
		{name: "emoji", content: strings.Repeat("🧠✨🤝🌏", 32)},
		{name: "high-entropy", content: strings.Repeat("9f86d081884c7d659a2feaa0c55ad015", 32)},
	}
	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			item := agentTurnContextItem{
				StableID:       "source.behavior.token-bound-\"escaped\"",
				LaneID:         agentTurnContextLaneSourceBehavior,
				SourcePath:     "character.core.psychology\nprofile",
				AuthorityOwner: agentTurnContextAuthorityRealmSnapshot,
				TrustClass:     agentTurnContextTrustValidatedSource,
				Segments: []agentTurnContextSegment{{
					Role:    "system",
					Content: "quoted=\"value\"\n" + testCase.content,
				}},
				Media: []agentTurnContextMedia{{
					MediaID:     "media-token-bound",
					Kind:        "image",
					MIMEType:    "image/png",
					ArtifactRef: "artifact-token-bound",
				}},
				Included: true,
			}
			messages := agentTurnContextProviderMessagesForItem(item)
			if len(messages) != 1 || !strings.Contains(messages[0].Content, `content_json_string="quoted=\"value\"\n`) {
				t.Fatalf("provider-visible system envelope was not applied before estimation: %+v", messages)
			}
			got, err := estimateAgentTurnContextItemTokens(item)
			if err != nil {
				t.Fatal(err)
			}
			message := messages[0]
			want, ok := addAgentTurnContextTokens(uint64(len(message.Role)), uint64(len(message.Content)), agentTurnContextMessageTokenOverheadUpperBound)
			if !ok {
				t.Fatal("provider-visible message fixture overflowed")
			}
			for _, media := range message.Media {
				want, ok = addAgentTurnContextTokens(want, uint64(len(media.MediaID)), uint64(len(media.Kind)), uint64(len(media.MIMEType)), uint64(len(media.ArtifactRef)), agentTurnContextMediaTokenOverheadUpperBound)
				if !ok {
					t.Fatal("provider-visible media fixture overflowed")
				}
			}
			if got != want {
				t.Fatalf("UTF-8 byte token upper bound=%d want=%d", got, want)
			}
			legacyRuneQuarter := uint64((utf8.RuneCountInString(message.Role)+utf8.RuneCountInString(message.Content)+3)/4) + 4
			if testCase.name != "high-entropy" && got <= legacyRuneQuarter {
				t.Fatalf("multibyte provider text was not conservatively bounded: got=%d legacy=%d", got, legacyRuneQuarter)
			}
		})
	}
}

func TestAgentTurnContextUTF8TokenBoundControlsCapacityAdmission(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.CurrentUserTurn.Text = strings.Repeat("世界🧠关系✨knowledge-9f86d081", 256)
	input.Budget.ContextWindowTokens = 1 << 30
	full, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	reserved, ok := addAgentTurnContextTokens(input.Budget.ReservedOutputTokens, input.Budget.ReservedSafetyTokens, input.Budget.ReservedAdapterTokens)
	if !ok {
		t.Fatal("fixture reservations overflowed")
	}
	exactWindow, ok := addAgentTurnContextTokens(reserved, full.Manifest.Budget.RequiredTokens)
	if !ok {
		t.Fatal("fixture exact context window overflowed")
	}
	input.Budget.ContextWindowTokens = exactWindow
	admitted, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatalf("mandatory UTF-8 context did not fit its exact conservative bound: %v", err)
	}
	admittedTotal, ok := addAgentTurnContextTokens(
		admitted.Manifest.Budget.UsedTokens,
		admitted.Manifest.Budget.ReservedOutputTokens,
		admitted.Manifest.Budget.ReservedSafetyTokens,
		admitted.Manifest.Budget.ReservedAdapterTokens,
	)
	if !ok || admitted.Manifest.Budget.UsedTokens > admitted.Manifest.Budget.InputBudgetTokens || admittedTotal > input.Budget.ContextWindowTokens {
		t.Fatalf("admitted provider context exceeded resolved capacity: manifest=%+v total=%d", admitted.Manifest.Budget, admittedTotal)
	}

	input.Budget.ContextWindowTokens = exactWindow - 1
	rejected, err := compileAgentTurnContext(input)
	if rejected != nil {
		t.Fatal("mandatory UTF-8 overflow returned a provider-visible prompt")
	}
	var capacity *agentTurnContextCapacityExceededError
	if !errors.As(err, &capacity) {
		t.Fatalf("mandatory UTF-8 overflow error=%T %v", err, err)
	}
	if capacity.RequiredTokens != full.Manifest.Budget.RequiredTokens || capacity.AvailableTokens != full.Manifest.Budget.RequiredTokens-1 || capacity.Summary == nil || capacity.Summary.GetReady() {
		t.Fatalf("mandatory UTF-8 overflow did not fail closed with typed capacity evidence: %+v", capacity)
	}
}

func TestAgentTurnContextTokenUpperBoundRejectsInvalidUTF8(t *testing.T) {
	t.Parallel()
	item := agentTurnContextItem{
		Segments: []agentTurnContextSegment{{Role: "user", Content: string([]byte{0xff})}},
		Included: true,
	}
	if _, err := estimateAgentTurnContextItemTokens(item); err == nil {
		t.Fatal("invalid provider-visible UTF-8 was admitted")
	}
}

func agentTurnContextTestProviderText(prompt agentTurnProviderPrompt) string {
	parts := make([]string, 0, len(prompt.Messages))
	for _, message := range prompt.Messages {
		parts = append(parts, message.Content)
	}
	return strings.Join(parts, "\n")
}
