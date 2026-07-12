package runtimeagent

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	// Provider tokenizers and message adapters do not share one exact token
	// accounting algorithm. Count every final provider-visible UTF-8 byte as a
	// token, then reserve fixed room for the structural/special tokens attached
	// to each message and media part. This is a conservative admission bound,
	// not a claim about any provider's tokenizer precision.
	agentTurnContextMessageTokenOverheadUpperBound uint64 = 32
	agentTurnContextMediaTokenOverheadUpperBound   uint64 = 256
)

var agentTurnContextFixedLaneOrder = []agentTurnContextLaneID{
	agentTurnContextLaneRuntimePolicy,
	agentTurnContextLaneOutputContract,
	agentTurnContextLaneSourceIdentity,
	agentTurnContextLaneSourceBehavior,
	agentTurnContextLaneWorldContext,
	agentTurnContextLaneRelationshipContext,
	agentTurnContextLaneSourceKnowledge,
	agentTurnContextLaneCanonicalMemory,
	agentTurnContextLaneConversationHistory,
	agentTurnContextLaneCapabilityContext,
	agentTurnContextLaneCurrentUserTurn,
}

type agentTurnContextLaneDefinition struct {
	Authority agentTurnContextAuthority
	Trust     agentTurnContextTrustClass
}

var agentTurnContextLaneDefinitions = map[agentTurnContextLaneID]agentTurnContextLaneDefinition{
	agentTurnContextLaneRuntimePolicy:       {agentTurnContextAuthorityRuntimePolicy, agentTurnContextTrustSystemAuthority},
	agentTurnContextLaneOutputContract:      {agentTurnContextAuthorityRuntimePolicy, agentTurnContextTrustSystemAuthority},
	agentTurnContextLaneSourceIdentity:      {agentTurnContextAuthorityRealmSnapshot, agentTurnContextTrustValidatedSource},
	agentTurnContextLaneSourceBehavior:      {agentTurnContextAuthorityRealmSnapshot, agentTurnContextTrustValidatedSource},
	agentTurnContextLaneWorldContext:        {agentTurnContextAuthorityRealmSnapshot, agentTurnContextTrustValidatedSource},
	agentTurnContextLaneRelationshipContext: {agentTurnContextAuthorityRelationshipLane, agentTurnContextTrustMixedRelation},
	agentTurnContextLaneSourceKnowledge:     {agentTurnContextAuthorityRealmSnapshot, agentTurnContextTrustValidatedSource},
	agentTurnContextLaneCanonicalMemory:     {agentTurnContextAuthorityRuntimeMemory, agentTurnContextTrustRuntimeScoped},
	agentTurnContextLaneConversationHistory: {agentTurnContextAuthorityRuntimeTranscript, agentTurnContextTrustRuntimeScoped},
	agentTurnContextLaneCapabilityContext:   {agentTurnContextAuthorityRuntimeCapability, agentTurnContextTrustSystemAuthority},
	agentTurnContextLaneCurrentUserTurn:     {agentTurnContextAuthorityCallerTurn, agentTurnContextTrustCallerInput},
}

type agentTurnContextTextField struct {
	Name   string
	Values []string
}

func agentTurnContextTypedContent(heading string, fields ...agentTurnContextTextField) string {
	var builder strings.Builder
	builder.WriteString(strings.TrimSpace(heading))
	for _, field := range fields {
		name := strings.TrimSpace(field.Name)
		if name == "" || len(field.Values) == 0 {
			continue
		}
		values := make([]string, 0, len(field.Values))
		for _, value := range field.Values {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				values = append(values, strconv.Quote(trimmed))
			}
		}
		if len(values) == 0 {
			continue
		}
		builder.WriteByte('\n')
		builder.WriteString(name)
		builder.WriteByte('=')
		builder.WriteString(strings.Join(values, ","))
	}
	return builder.String()
}

func agentTurnContextOptionalString(value *string) []string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return []string{*value}
}

func agentTurnContextOptionalStrings(value *[]string) []string {
	if value == nil {
		return nil
	}
	return append([]string(nil), (*value)...)
}

func newAgentTurnContextItem(
	laneID agentTurnContextLaneID,
	stableID string,
	sourcePath string,
	sourceRef agentTurnContextItemSourceRef,
	authority agentTurnContextAuthority,
	trust agentTurnContextTrustClass,
	priority int64,
	rank int64,
	mandatory bool,
	truncationClass agentTurnContextTruncationClass,
	segments []agentTurnContextSegment,
	media []agentTurnContextMedia,
) (agentTurnContextItem, error) {
	stableID = strings.TrimSpace(stableID)
	sourcePath = strings.TrimSpace(sourcePath)
	if _, admitted := agentTurnContextLaneDefinitions[laneID]; !admitted {
		return agentTurnContextItem{}, fmt.Errorf("agent turn context lane %q is not admitted", laneID)
	}
	if stableID == "" || sourcePath == "" || strings.TrimSpace(sourceRef.Kind) == "" || strings.TrimSpace(sourceRef.RefID) == "" || strings.TrimSpace(sourceRef.SchemaVersion) == "" || !validSHA256Hex(sourceRef.ContentHash) {
		return agentTurnContextItem{}, fmt.Errorf("agent turn context item identity is invalid")
	}
	if authority == "" || trust == "" || len(segments) == 0 {
		return agentTurnContextItem{}, fmt.Errorf("agent turn context item authority or content is invalid")
	}
	for _, segment := range segments {
		if segment.Role != "system" && segment.Role != "user" && segment.Role != "assistant" && segment.Role != "tool" {
			return agentTurnContextItem{}, fmt.Errorf("agent turn context item role %q is not admitted", segment.Role)
		}
		if strings.TrimSpace(segment.Content) == "" && len(media) == 0 {
			return agentTurnContextItem{}, fmt.Errorf("agent turn context item segment is empty")
		}
	}
	item := agentTurnContextItem{
		StableID:        stableID,
		LaneID:          laneID,
		SourcePath:      sourcePath,
		SourceRef:       sourceRef,
		AuthorityOwner:  authority,
		TrustClass:      trust,
		Priority:        priority,
		Rank:            rank,
		Mandatory:       mandatory,
		TruncationClass: truncationClass,
		Segments:        append([]agentTurnContextSegment(nil), segments...),
		Media:           append([]agentTurnContextMedia(nil), media...),
		Included:        true,
	}
	hash, err := hashAgentTurnContextItem(item)
	if err != nil {
		return agentTurnContextItem{}, fmt.Errorf("hash agent turn context item %s: %w", stableID, err)
	}
	item.ContentHash = hash
	tokenEstimate, err := estimateAgentTurnContextItemTokens(item)
	if err != nil {
		return agentTurnContextItem{}, fmt.Errorf("estimate agent turn context item %s tokens: %w", stableID, err)
	}
	item.TokenEstimate = tokenEstimate
	return item, nil
}

func newAgentTurnContextRuntimeRef(kind, refID, version, provenance string) (agentTurnContextItemSourceRef, error) {
	hash, err := hashAgentTurnContextRef(kind, refID, version, provenance)
	if err != nil {
		return agentTurnContextItemSourceRef{}, err
	}
	return agentTurnContextItemSourceRef{Kind: kind, RefID: refID, SchemaVersion: version, ContentHash: hash}, nil
}

func newAgentTurnContextRuntimeRefValue(kind, refID, version string, value any) (agentTurnContextItemSourceRef, error) {
	hash, err := hashSourceMaterializationDomainJCS(agentTurnContextRefHashDomain, struct {
		Kind    string `json:"kind"`
		RefID   string `json:"refId"`
		Version string `json:"version"`
		Value   any    `json:"value"`
	}{kind, refID, version, value})
	if err != nil {
		return agentTurnContextItemSourceRef{}, err
	}
	return agentTurnContextItemSourceRef{Kind: kind, RefID: refID, SchemaVersion: version, ContentHash: hash}, nil
}

func agentTurnContextProviderMessagesForItem(item agentTurnContextItem) []agentTurnProviderMessage {
	if !item.Included {
		return nil
	}
	messages := make([]agentTurnProviderMessage, 0, len(item.Segments))
	for index, segment := range item.Segments {
		content := segment.Content
		if segment.Role == "system" {
			content = agentTurnContextSystemEnvelope(item, segment.Content)
		}
		message := agentTurnProviderMessage{Role: segment.Role, Content: content}
		if index == len(item.Segments)-1 && len(item.Media) > 0 {
			message.Media = append([]agentTurnContextMedia(nil), item.Media...)
		}
		messages = append(messages, message)
	}
	return messages
}

func agentTurnContextSystemEnvelope(item agentTurnContextItem, content string) string {
	return strings.Join([]string{
		"[NIMI_TYPED_CONTEXT_ITEM]",
		"lane=" + string(item.LaneID),
		"authority=" + string(item.AuthorityOwner),
		"trust=" + string(item.TrustClass),
		"content_json_string=" + strconv.Quote(content),
		"[/NIMI_TYPED_CONTEXT_ITEM]",
	}, "\n")
}

func estimateAgentTurnContextItemTokens(item agentTurnContextItem) (uint64, error) {
	var tokens uint64
	for _, message := range agentTurnContextProviderMessagesForItem(item) {
		messageTokens, err := agentTurnContextUTF8ByteTokenUpperBound(message.Role, message.Content)
		if err != nil {
			return 0, err
		}
		messageTokens, ok := addAgentTurnContextTokens(messageTokens, agentTurnContextMessageTokenOverheadUpperBound)
		if !ok {
			return 0, fmt.Errorf("provider message token upper bound overflow")
		}
		for _, media := range message.Media {
			mediaTokens, err := agentTurnContextUTF8ByteTokenUpperBound(media.MediaID, media.Kind, media.MIMEType, media.ArtifactRef)
			if err != nil {
				return 0, err
			}
			messageTokens, ok = addAgentTurnContextTokens(messageTokens, mediaTokens, agentTurnContextMediaTokenOverheadUpperBound)
			if !ok {
				return 0, fmt.Errorf("provider media token upper bound overflow")
			}
		}
		tokens, ok = addAgentTurnContextTokens(tokens, messageTokens)
		if !ok {
			return 0, fmt.Errorf("provider prompt token upper bound overflow")
		}
	}
	if tokens == 0 {
		return 1, nil
	}
	return tokens, nil
}

func agentTurnContextUTF8ByteTokenUpperBound(values ...string) (uint64, error) {
	var tokens uint64
	for _, value := range values {
		if !utf8.ValidString(value) {
			return 0, fmt.Errorf("provider-visible context contains invalid UTF-8")
		}
		var ok bool
		tokens, ok = addAgentTurnContextTokens(tokens, uint64(len(value)))
		if !ok {
			return 0, fmt.Errorf("provider-visible UTF-8 byte count overflow")
		}
	}
	return tokens, nil
}

func makeAgentTurnContextLanes(items map[agentTurnContextLaneID][]agentTurnContextItem) ([]agentTurnContextLane, error) {
	lanes := make([]agentTurnContextLane, 0, len(agentTurnContextFixedLaneOrder))
	for _, laneID := range agentTurnContextFixedLaneOrder {
		definition := agentTurnContextLaneDefinitions[laneID]
		laneItems := append([]agentTurnContextItem(nil), items[laneID]...)
		orderAgentTurnContextLaneItems(laneID, laneItems)
		seen := make(map[string]struct{}, len(laneItems))
		for _, item := range laneItems {
			if item.LaneID != laneID {
				return nil, fmt.Errorf("agent turn context item %q is assigned to the wrong lane", item.StableID)
			}
			if _, duplicate := seen[item.StableID]; duplicate {
				return nil, fmt.Errorf("duplicate agent turn context item %q", item.StableID)
			}
			seen[item.StableID] = struct{}{}
		}
		lanes = append(lanes, agentTurnContextLane{LaneID: laneID, AuthorityOwner: definition.Authority, TrustClass: definition.Trust, Items: laneItems})
	}
	return lanes, nil
}

func orderAgentTurnContextLaneItems(laneID agentTurnContextLaneID, items []agentTurnContextItem) {
	sort.SliceStable(items, func(i, j int) bool {
		switch laneID {
		case agentTurnContextLaneConversationHistory:
			if items[i].Rank != items[j].Rank {
				return items[i].Rank < items[j].Rank
			}
		case agentTurnContextLaneCanonicalMemory:
			if items[i].Rank != items[j].Rank {
				return items[i].Rank > items[j].Rank
			}
		default:
			if items[i].Priority != items[j].Priority {
				return items[i].Priority > items[j].Priority
			}
		}
		return items[i].StableID < items[j].StableID
	})
}
