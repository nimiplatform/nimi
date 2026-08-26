package runtimeagent

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAgentTurnContextProviderSequencePlacesOutputContractBeforeCurrentTurn(t *testing.T) {
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
		agentTurnContextLaneSourceIdentity,
		agentTurnContextLaneSourceBehavior,
		agentTurnContextLaneRelationshipContext,
		agentTurnContextLaneCanonicalMemory,
		agentTurnContextLaneCapabilityContext,
	} {
		if _, ok := positions[laneID]; !ok {
			t.Fatalf("provider prompt is missing lane %s", laneID)
		}
	}
	orderedSystemLanes := []agentTurnContextLaneID{
		agentTurnContextLaneRuntimePolicy,
		agentTurnContextLaneSourceIdentity,
		agentTurnContextLaneSourceBehavior,
		agentTurnContextLaneRelationshipContext,
		agentTurnContextLaneCanonicalMemory,
	}
	for index := 1; index < len(orderedSystemLanes); index++ {
		if positions[orderedSystemLanes[index-1]] >= positions[orderedSystemLanes[index]] {
			t.Fatalf("provider lane %s was not after %s", orderedSystemLanes[index], orderedSystemLanes[index-1])
		}
	}
	var historyAssistantIndex = -1
	var outputContractIndex = -1
	var currentUserIndex = -1
	for index, message := range compiled.ProviderPrompt.Messages {
		if message.Role == "assistant" && message.Content == "This is the canonical fixture world." {
			historyAssistantIndex = index
		}
		if message.Role == "user" && message.Content == "Continue from our prior conversation." {
			currentUserIndex = index
		}
		if message.Role == "user" && strings.Contains(message.Content, `Return one strict <message id="message-0">`) {
			outputContractIndex = index
		}
	}
	if historyAssistantIndex < 0 || currentUserIndex < 0 ||
		positions[agentTurnContextLaneCapabilityContext] <= historyAssistantIndex ||
		currentUserIndex <= positions[agentTurnContextLaneCapabilityContext] ||
		outputContractIndex != currentUserIndex+1 ||
		outputContractIndex != len(compiled.ProviderPrompt.Messages)-1 {
		t.Fatalf("provider history/capability/output-contract/current order is invalid: history=%d capability=%d outputContract=%d current=%d total=%d", historyAssistantIndex, positions[agentTurnContextLaneCapabilityContext], outputContractIndex, currentUserIndex, len(compiled.ProviderPrompt.Messages))
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
	input.ConversationSummary = &agentTurnConversationSummaryInput{
		Status: "ready", Revision: 1, CoveredSequenceStart: 0, CoveredSequenceEnd: 0,
		Text: "summary-canary-" + strings.Repeat("S", 800), RouteCorrelation: strings.Repeat("3", 64),
	}
	input.Budget.ContextWindowTokens = 1 << 30
	full, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	history := agentTurnContextTestLane(t, full.PrivateLanes, agentTurnContextLaneConversationHistory)
	memory := agentTurnContextTestLane(t, full.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	summary := agentTurnContextTestLane(t, full.PrivateLanes, agentTurnContextLaneConversationSummary)
	if len(history.Items) != 2 || len(memory.Items) != 2 || len(summary.Items) != 1 {
		t.Fatalf("summary=%d history=%d memory=%d", len(summary.Items), len(history.Items), len(memory.Items))
	}
	reserved := input.Budget.ReservedOutputTokens + input.Budget.ReservedReasoningTokens + input.Budget.ReservedSafetyTokens + input.Budget.ReservedAdapterTokens
	input.Budget.ContextWindowTokens = reserved + full.Manifest.Budget.UsedTokens - summary.Items[0].TokenEstimate
	trimOldest, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	trimmedHistory := agentTurnContextTestLane(t, trimOldest.PrivateLanes, agentTurnContextLaneConversationHistory)
	trimmedMemory := agentTurnContextTestLane(t, trimOldest.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	trimmedSummary := agentTurnContextTestLane(t, trimOldest.PrivateLanes, agentTurnContextLaneConversationSummary)
	if trimmedSummary.TruncatedCount != 1 {
		t.Fatalf("conversation summary was not removed before transcript: %+v", trimmedSummary.Items)
	}
	if !trimmedHistory.Items[0].Included || !trimmedHistory.Items[1].Included {
		t.Fatalf("conversation history was truncated before the summary: %+v", trimmedHistory.Items)
	}
	if !trimmedMemory.Items[0].Included || !trimmedMemory.Items[1].Included {
		t.Fatalf("memory was truncated before history: %+v", trimmedMemory.Items)
	}
	providerText := agentTurnContextTestProviderText(trimOldest.ProviderPrompt)
	if strings.Contains(providerText, "summary-canary") || !strings.Contains(providerText, "old-user-canary") || !strings.Contains(providerText, "old-assistant-canary") || !strings.Contains(providerText, "new-user-canary") || !strings.Contains(providerText, "new-assistant-canary") {
		t.Fatal("conversation summary was not omitted as one item before recent history")
	}

	historyTokens := history.Items[0].TokenEstimate + history.Items[1].TokenEstimate
	lowMemoryTokens := memory.Items[1].TokenEstimate
	input.Budget.ContextWindowTokens = reserved + full.Manifest.Budget.UsedTokens - summary.Items[0].TokenEstimate - historyTokens - lowMemoryTokens
	trimMemory, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	trimmedHistory = agentTurnContextTestLane(t, trimMemory.PrivateLanes, agentTurnContextLaneConversationHistory)
	trimmedMemory = agentTurnContextTestLane(t, trimMemory.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	trimmedSummary = agentTurnContextTestLane(t, trimMemory.PrivateLanes, agentTurnContextLaneConversationSummary)
	if trimmedSummary.TruncatedCount != 1 || trimmedHistory.TruncatedCount != 2 || trimmedMemory.TruncatedCount != 1 || !trimmedMemory.Items[0].Included || trimmedMemory.Items[1].Included {
		t.Fatalf("fixed summary->history->low-memory truncation failed: summary=%+v history=%+v memory=%+v", trimmedSummary, trimmedHistory, trimmedMemory)
	}
	providerText = agentTurnContextTestProviderText(trimMemory.ProviderPrompt)
	if strings.Contains(providerText, "low-memory-canary") || !strings.Contains(providerText, "high-memory-canary") {
		t.Fatal("memory truncation did not remove the whole lowest-ranked item")
	}
	if trimMemory.Summary.GetTruncation()[0].GetReason().String() != "AGENT_TURN_CONTEXT_TRUNCATION_REASON_INPUT_BUDGET_EXHAUSTED" {
		t.Fatalf("truncation reason=%s", trimMemory.Summary.GetTruncation()[0].GetReason())
	}
}

func TestAgentTurnContextBudgetCapsOptionalRealmSourceForInteractiveLatency(t *testing.T) {
	t.Parallel()
	hash := strings.Repeat("a", 64)
	lanes := []agentTurnContextLane{
		{
			LaneID: agentTurnContextLaneSourceIdentity,
			Items: []agentTurnContextItem{{
				StableID: "source.identity.core", AuthorityOwner: agentTurnContextAuthorityRealmSnapshot,
				Mandatory: true, TruncationClass: agentTurnContextTruncationNone,
				ContentHash: hash, TokenEstimate: 2460,
			}},
		},
		{
			LaneID: agentTurnContextLaneSourceKnowledge,
			Items: []agentTurnContextItem{{
				StableID: "source.knowledge.typed", AuthorityOwner: agentTurnContextAuthorityRealmSnapshot,
				Priority: 600, TruncationClass: agentTurnContextTruncationKnowledge,
				ContentHash: hash, TokenEstimate: 3340,
			}},
		},
		{LaneID: agentTurnContextLaneWorldContext},
		{LaneID: agentTurnContextLaneRelationshipContext},
		{
			LaneID: agentTurnContextLaneConversationHistory,
			Items: []agentTurnContextItem{{
				StableID:        "runtime.transcript.sequence.00000000000000000013",
				AuthorityOwner:  agentTurnContextAuthorityRuntimeTranscript,
				TruncationClass: agentTurnContextTruncationHistory,
				ContentHash:     hash, TokenEstimate: 3597,
			}},
		},
		{
			LaneID: agentTurnContextLaneCurrentUserTurn,
			Items: []agentTurnContextItem{{
				StableID: "caller.current-turn", AuthorityOwner: agentTurnContextAuthorityCallerTurn,
				Mandatory: true, TruncationClass: agentTurnContextTruncationNone,
				ContentHash: hash, TokenEstimate: 75,
			}},
		},
	}
	for index := 0; index < 40; index++ {
		lanes[2].Items = append(lanes[2].Items, agentTurnContextItem{
			StableID:       fmt.Sprintf("source.world.detail.%03d", index),
			AuthorityOwner: agentTurnContextAuthorityRealmSnapshot,
			Priority:       100, TruncationClass: agentTurnContextTruncationWorldDetail,
			ContentHash: hash, TokenEstimate: 4000,
		})
		lanes[3].Items = append(lanes[3].Items, agentTurnContextItem{
			StableID:       fmt.Sprintf("source.relationship.world.%03d", index),
			AuthorityOwner: agentTurnContextAuthorityRealmSnapshot,
			Priority:       100, TruncationClass: agentTurnContextTruncationWorldDetail,
			ContentHash: hash, TokenEstimate: 4000,
		})
	}
	input := agentTurnContextBudgetInput{
		ContextWindowTokens:     144384,
		ReservedOutputTokens:    1024,
		ReservedReasoningTokens: 384,
		ReservedSafetyTokens:    512,
		ReservedAdapterTokens:   256,
	}
	result, err := applyAgentTurnContextBudget(lanes, input)
	if err != nil {
		t.Fatal(err)
	}
	optionalBudget := agentTurnContextOptionalRealmSourceBudget(result.Manifest.InputBudgetTokens, input.ReservedOutputTokens)
	var optionalUsed uint64
	var includedUsed uint64
	for _, lane := range lanes {
		for _, item := range lane.Items {
			if !item.Included {
				continue
			}
			includedUsed += item.TokenEstimate
			if isOptionalRealmSourceContextItem(item) {
				optionalUsed += item.TokenEstimate
			}
		}
	}
	if optionalUsed == 0 || optionalUsed > optionalBudget {
		t.Fatalf("optional Realm source used=%d budget=%d", optionalUsed, optionalBudget)
	}
	if !lanes[1].Items[0].Included {
		t.Fatal("higher-priority source knowledge was not retained by the optional Realm source budget")
	}
	if !lanes[4].Items[0].Included || lanes[4].Items[0].Truncated {
		t.Fatal("Runtime-owned recent transcript was truncated by optional Realm source materialization")
	}
	if lanes[2].TruncatedCount == 0 || lanes[3].TruncatedCount == 0 {
		t.Fatalf("large optional World closure was not bounded: world=%+v relationship=%+v", lanes[2], lanes[3])
	}
	if result.Manifest.UsedTokens != includedUsed || result.Manifest.UsedTokens >= result.Manifest.InputBudgetTokens/3 {
		t.Fatalf("interactive prompt was not materially bounded: manifest=%+v included=%d", result.Manifest, includedUsed)
	}
}

func TestAgentTurnContextBudgetReservesExplicitReasoningCapacity(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.Budget.ContextWindowTokens = 1 << 20
	input.Budget.ReservedReasoningTokens = 777
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	wantInputBudget := input.Budget.ContextWindowTokens - input.Budget.ReservedOutputTokens - input.Budget.ReservedReasoningTokens - input.Budget.ReservedSafetyTokens - input.Budget.ReservedAdapterTokens
	if compiled.Manifest.Budget.ReservedReasoningTokens != 777 || compiled.Manifest.Budget.InputBudgetTokens != wantInputBudget {
		t.Fatalf("reasoning reserve was not admitted by planner: %+v", compiled.Manifest.Budget)
	}
	if budget := compiled.Summary.GetBudget(); budget.GetReservedReasoningTokens() != 777 || budget.GetInputBudgetTokens() != wantInputBudget {
		t.Fatalf("reasoning reserve was not projected: %+v", budget)
	}
}

func TestAgentTurnContextBudgetReservesOutputUpperBoundForUnboundedReasoning(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.Budget.ReservedReasoningTokens = publicChatReasoningReserveTokens(&publicChatReasoningConfig{
		Mode: runtimev1.ReasoningMode_REASONING_MODE_ON,
	}, input.Budget.ReservedOutputTokens)
	if input.Budget.ReservedReasoningTokens != input.Budget.ReservedOutputTokens {
		t.Fatalf("unbounded reasoning reserve=%d want captured output upper bound=%d", input.Budget.ReservedReasoningTokens, input.Budget.ReservedOutputTokens)
	}
	if got := publicChatReasoningReserveTokens(&publicChatReasoningConfig{Mode: runtimev1.ReasoningMode_REASONING_MODE_ON, BudgetTokens: 333}, input.Budget.ReservedOutputTokens); got != 333 {
		t.Fatalf("explicit reasoning reserve=%d want 333", got)
	}
	if got := publicChatReasoningReserveTokens(&publicChatReasoningConfig{Mode: runtimev1.ReasoningMode_REASONING_MODE_OFF}, input.Budget.ReservedOutputTokens); got != 0 {
		t.Fatalf("disabled reasoning reserved %d tokens", got)
	}

	input.Budget.ContextWindowTokens = 1 << 20
	full, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	reserved, ok := addAgentTurnContextTokens(
		input.Budget.ReservedOutputTokens,
		input.Budget.ReservedReasoningTokens,
		input.Budget.ReservedSafetyTokens,
		input.Budget.ReservedAdapterTokens,
	)
	if !ok {
		t.Fatal("reasoning reservation overflowed")
	}
	exactWindow, ok := addAgentTurnContextTokens(reserved, full.Manifest.Budget.RequiredTokens)
	if !ok {
		t.Fatal("exact reasoning capacity overflowed")
	}
	input.Budget.ContextWindowTokens = exactWindow
	if _, err := compileAgentTurnContext(input); err != nil {
		t.Fatalf("mandatory context did not fit exact reasoning-aware capacity: %v", err)
	}
	input.Budget.ContextWindowTokens = exactWindow - 1
	if compiled, err := compileAgentTurnContext(input); compiled != nil {
		t.Fatal("reasoning-aware capacity overflow returned provider context")
	} else {
		var capacity *agentTurnContextCapacityExceededError
		if !errors.As(err, &capacity) || capacity.AvailableTokens != full.Manifest.Budget.RequiredTokens-1 {
			t.Fatalf("reasoning-aware capacity error=%T %+v", err, err)
		}
	}
}

func TestAgentTurnContextRelationalContinuitySurvivesOptionalTruncation(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.Relationships = []agentTurnRelationshipInput{{
		RelationshipID: "memory-preferred-name",
		Scope:          "dyadic",
		ProvenanceRef:  "runtime.agent.internal.chat_sidecar:turn-relationship:memory-preferred-name",
		Summary:        "user preferred_name 墨契",
		Rank:           2,
	}}
	input.Memory = []agentTurnMemoryInput{{
		MemoryID:      "memory-preferred-name",
		Scope:         "dyadic",
		ProvenanceRef: "runtime.agent.internal.chat_sidecar:turn-relationship:memory-preferred-name",
		Text:          "user preferred_name 墨契",
		RelevanceRank: 2,
	}}
	full, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	reserved := input.Budget.ReservedOutputTokens + input.Budget.ReservedReasoningTokens + input.Budget.ReservedSafetyTokens + input.Budget.ReservedAdapterTokens
	input.Budget.ContextWindowTokens = reserved + full.Manifest.Budget.RequiredTokens
	trimmed, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	relationships := agentTurnContextTestLane(t, trimmed.PrivateLanes, agentTurnContextLaneRelationshipContext)
	memory := agentTurnContextTestLane(t, trimmed.PrivateLanes, agentTurnContextLaneCanonicalMemory)
	var continuity *agentTurnContextItem
	for index := range relationships.Items {
		if relationships.Items[index].StableID == "runtime.relationship.memory-preferred-name" {
			continuity = &relationships.Items[index]
			break
		}
	}
	if continuity == nil || !continuity.Included || continuity.Truncated {
		t.Fatalf("relational continuity was not retained as mandatory context: %+v", relationships.Items)
	}
	if len(memory.Items) != 1 || !memory.Items[0].Truncated {
		t.Fatalf("canonical memory copy should remain optional under the admitted budget order: %+v", memory.Items)
	}
	if providerText := agentTurnContextTestProviderText(trimmed.ProviderPrompt); !strings.Contains(providerText, "墨契") {
		t.Fatal("provider-visible relationship context lost the preferred-name continuity fact")
	}
}

func TestAgentTurnContextMandatoryOverflowFailsClosedWithTypedSummary(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "personaCharacter")
	full, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	reserved := input.Budget.ReservedOutputTokens + input.Budget.ReservedReasoningTokens + input.Budget.ReservedSafetyTokens + input.Budget.ReservedAdapterTokens
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
	reserved := input.Budget.ReservedOutputTokens + input.Budget.ReservedReasoningTokens + input.Budget.ReservedSafetyTokens + input.Budget.ReservedAdapterTokens
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

func TestAgentTurnContextProviderEnvelopeDoesNotDuplicateManifestProvenance(t *testing.T) {
	t.Parallel()
	item := agentTurnContextItem{
		StableID:       strings.Repeat("stable-id-segment.", 64),
		LaneID:         agentTurnContextLaneWorldContext,
		SourcePath:     strings.Repeat("world.core.deeply.nested.path.", 64),
		AuthorityOwner: agentTurnContextAuthorityRealmSnapshot,
		TrustClass:     agentTurnContextTrustValidatedSource,
		Segments: []agentTurnContextSegment{{
			Role:    "system",
			Content: "canonical world baseline",
		}},
		Included: true,
	}
	messages := agentTurnContextProviderMessagesForItem(item)
	if len(messages) != 1 {
		t.Fatalf("provider envelope message count=%d, want 1", len(messages))
	}
	content := messages[0].Content
	for _, required := range []string{
		"[NIMI_TYPED_CONTEXT_ITEM]",
		"lane=world_context",
		"authority=realm_source_snapshot",
		"trust=validated_source_data",
		`content_json_string="canonical world baseline"`,
		"[/NIMI_TYPED_CONTEXT_ITEM]",
	} {
		if !strings.Contains(content, required) {
			t.Fatalf("provider envelope omitted %q: %q", required, content)
		}
	}
	if strings.Contains(content, item.StableID) || strings.Contains(content, item.SourcePath) || strings.Contains(content, "stable_id_json_string=") || strings.Contains(content, "source_path_json_string=") {
		t.Fatalf("provider envelope duplicated manifest-only provenance: %q", content)
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
	reserved, ok := addAgentTurnContextTokens(input.Budget.ReservedOutputTokens, input.Budget.ReservedReasoningTokens, input.Budget.ReservedSafetyTokens, input.Budget.ReservedAdapterTokens)
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
		admitted.Manifest.Budget.ReservedReasoningTokens,
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
