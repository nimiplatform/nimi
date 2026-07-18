package runtimeagent

import "fmt"

const (
	agentTurnContextItemHashDomain     = "nimi.runtime.agent-context-item/v1\x00"
	agentTurnContextLaneHashDomain     = "nimi.runtime.agent-context-lane/v1\x00"
	agentTurnContextContentHashDomain  = "nimi.runtime.agent-context-content/v1\x00"
	agentTurnContextPromptHashDomain   = "nimi.runtime.agent-provider-prompt/v1\x00"
	agentTurnContextManifestHashDomain = "nimi.runtime.agent-context-manifest/v1\x00"
	agentTurnContextRefHashDomain      = "nimi.runtime.agent-context-ref/v1\x00"
	agentTurnContextCapabilityDomain   = "nimi.runtime.agent-context-capability/v1\x00"
)

type agentTurnContextItemSemanticV1 struct {
	StableID       string                        `json:"stableId"`
	LaneID         agentTurnContextLaneID        `json:"laneId"`
	SourcePath     string                        `json:"sourcePath"`
	SourceRef      agentTurnContextItemSourceRef `json:"sourceRef"`
	AuthorityOwner agentTurnContextAuthority     `json:"authorityOwner"`
	TrustClass     agentTurnContextTrustClass    `json:"trustClass"`
	Priority       int64                         `json:"priority"`
	Segments       []agentTurnContextSegment     `json:"segments"`
	Media          []agentTurnContextMedia       `json:"media"`
}

type agentTurnContextLaneSemanticV1 struct {
	LaneID         agentTurnContextLaneID           `json:"laneId"`
	AuthorityOwner agentTurnContextAuthority        `json:"authorityOwner"`
	TrustClass     agentTurnContextTrustClass       `json:"trustClass"`
	Items          []agentTurnContextItemSemanticV1 `json:"items"`
}

func hashAgentTurnContextItem(item agentTurnContextItem) (string, error) {
	return hashSourceMaterializationDomainJCS(agentTurnContextItemHashDomain, agentTurnContextItemSemantic(item))
}

func agentTurnContextItemSemantic(item agentTurnContextItem) agentTurnContextItemSemanticV1 {
	return agentTurnContextItemSemanticV1{
		StableID:       item.StableID,
		LaneID:         item.LaneID,
		SourcePath:     item.SourcePath,
		SourceRef:      item.SourceRef,
		AuthorityOwner: item.AuthorityOwner,
		TrustClass:     item.TrustClass,
		Priority:       item.Priority,
		Segments:       append([]agentTurnContextSegment(nil), item.Segments...),
		Media:          append([]agentTurnContextMedia(nil), item.Media...),
	}
}

func hashAgentTurnContextLane(lane agentTurnContextLane) (string, error) {
	semantic := agentTurnContextLaneSemanticV1{
		LaneID:         lane.LaneID,
		AuthorityOwner: lane.AuthorityOwner,
		TrustClass:     lane.TrustClass,
		Items:          make([]agentTurnContextItemSemanticV1, 0, len(lane.Items)),
	}
	for _, item := range lane.Items {
		if item.Included {
			semantic.Items = append(semantic.Items, agentTurnContextItemSemantic(item))
		}
	}
	return hashSourceMaterializationDomainJCS(agentTurnContextLaneHashDomain, semantic)
}

func hashAgentTurnContextContent(lanes []agentTurnContextLane) (string, error) {
	semantic := make([]agentTurnContextLaneSemanticV1, 0, len(lanes))
	for _, lane := range lanes {
		entry := agentTurnContextLaneSemanticV1{
			LaneID:         lane.LaneID,
			AuthorityOwner: lane.AuthorityOwner,
			TrustClass:     lane.TrustClass,
			Items:          make([]agentTurnContextItemSemanticV1, 0, len(lane.Items)),
		}
		for _, item := range lane.Items {
			if item.Included {
				entry.Items = append(entry.Items, agentTurnContextItemSemantic(item))
			}
		}
		semantic = append(semantic, entry)
	}
	return hashSourceMaterializationDomainJCS(agentTurnContextContentHashDomain, semantic)
}

func hashAgentTurnProviderPrompt(prompt agentTurnProviderPrompt) (string, error) {
	return hashSourceMaterializationDomainJCS(agentTurnContextPromptHashDomain, prompt)
}

func hashAgentTurnContextManifest(manifest agentTurnContextManifestV1) (string, error) {
	if manifest.ManifestInstanceHash != "" {
		return "", fmt.Errorf("agent turn context manifest instance hash input must omit itself")
	}
	input := struct {
		ManifestSchemaVersion      string                                    `json:"manifestSchemaVersion"`
		CompilerSchemaVersion      string                                    `json:"compilerSchemaVersion"`
		LocalAgentRef              string                                    `json:"localAgentRef"`
		ConversationAnchorID       string                                    `json:"conversationAnchorId"`
		TurnID                     string                                    `json:"turnId"`
		RequestID                  string                                    `json:"requestId"`
		SourceSnapshotHash         string                                    `json:"sourceSnapshotHash"`
		SourceRef                  sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
		WorldContentHash           string                                    `json:"worldContentHash"`
		MaterializationContextHash string                                    `json:"materializationContextHash"`
		RouteDigest                string                                    `json:"routeDigest"`
		CatalogRevisionDigest      string                                    `json:"catalogRevisionDigest"`
		Budget                     agentTurnContextBudgetManifestV1          `json:"budget"`
		Lanes                      []agentTurnContextLaneManifestV1          `json:"lanes"`
		CapabilityDigest           string                                    `json:"capabilityDigest"`
		Transcript                 agentTurnContextTranscriptManifestV1      `json:"transcript"`
		MemoryItemCount            uint32                                    `json:"memoryItemCount"`
		MediaCount                 uint32                                    `json:"mediaCount"`
		ToolCount                  uint32                                    `json:"toolCount"`
		ContextContentHash         string                                    `json:"contextContentHash"`
		PromptHash                 string                                    `json:"promptHash"`
	}{
		ManifestSchemaVersion:      manifest.ManifestSchemaVersion,
		CompilerSchemaVersion:      manifest.CompilerSchemaVersion,
		LocalAgentRef:              manifest.LocalAgentRef,
		ConversationAnchorID:       manifest.ConversationAnchorID,
		TurnID:                     manifest.TurnID,
		RequestID:                  manifest.RequestID,
		SourceSnapshotHash:         manifest.SourceSnapshotHash,
		SourceRef:                  manifest.SourceRef,
		WorldContentHash:           manifest.WorldContentHash,
		MaterializationContextHash: manifest.MaterializationContextHash,
		RouteDigest:                manifest.RouteDigest,
		CatalogRevisionDigest:      manifest.CatalogRevisionDigest,
		Budget:                     manifest.Budget,
		Lanes:                      manifest.Lanes,
		CapabilityDigest:           manifest.CapabilityDigest,
		Transcript:                 manifest.Transcript,
		MemoryItemCount:            manifest.MemoryItemCount,
		MediaCount:                 manifest.MediaCount,
		ToolCount:                  manifest.ToolCount,
		ContextContentHash:         manifest.ContextContentHash,
		PromptHash:                 manifest.PromptHash,
	}
	return hashSourceMaterializationDomainJCS(agentTurnContextManifestHashDomain, input)
}

func hashAgentTurnContextRef(kind, refID, version, provenance string) (string, error) {
	return hashSourceMaterializationDomainJCS(agentTurnContextRefHashDomain, struct {
		Kind       string `json:"kind"`
		RefID      string `json:"refId"`
		Version    string `json:"version"`
		Provenance string `json:"provenance"`
	}{kind, refID, version, provenance})
}
