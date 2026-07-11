package runtimeagent

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	agentTurnContextManifestSchemaV1 = "nimi.runtime.agent-turn-context-manifest/v1"
	agentTurnContextCompilerSchemaV1 = "nimi.runtime.agent-turn-context-compiler/v1"
)

type agentTurnContextLaneID string

const (
	agentTurnContextLaneRuntimePolicy       agentTurnContextLaneID = "runtime_policy"
	agentTurnContextLaneOutputContract      agentTurnContextLaneID = "output_contract"
	agentTurnContextLaneSourceIdentity      agentTurnContextLaneID = "source_identity"
	agentTurnContextLaneSourceBehavior      agentTurnContextLaneID = "source_behavior"
	agentTurnContextLaneWorldContext        agentTurnContextLaneID = "world_context"
	agentTurnContextLaneRelationshipContext agentTurnContextLaneID = "relationship_context"
	agentTurnContextLaneSourceKnowledge     agentTurnContextLaneID = "source_knowledge"
	agentTurnContextLaneCanonicalMemory     agentTurnContextLaneID = "canonical_memory"
	agentTurnContextLaneConversationHistory agentTurnContextLaneID = "conversation_history"
	agentTurnContextLaneCapabilityContext   agentTurnContextLaneID = "capability_context"
	agentTurnContextLaneCurrentUserTurn     agentTurnContextLaneID = "current_user_turn"
)

type agentTurnContextAuthority string

const (
	agentTurnContextAuthorityRuntimePolicy     agentTurnContextAuthority = "runtime_policy"
	agentTurnContextAuthorityRealmSnapshot     agentTurnContextAuthority = "realm_source_snapshot"
	agentTurnContextAuthorityRuntimeMemory     agentTurnContextAuthority = "runtime_canonical_memory"
	agentTurnContextAuthorityRuntimeTranscript agentTurnContextAuthority = "runtime_committed_transcript"
	agentTurnContextAuthorityRuntimeCapability agentTurnContextAuthority = "runtime_capability_policy"
	agentTurnContextAuthorityCallerTurn        agentTurnContextAuthority = "authenticated_current_turn"
	agentTurnContextAuthorityRuntimeRelation   agentTurnContextAuthority = "runtime_scoped_relationship"
	agentTurnContextAuthorityRelationshipLane  agentTurnContextAuthority = "realm_source_snapshot+runtime_scoped_relationship"
)

type agentTurnContextTrustClass string

const (
	agentTurnContextTrustSystemAuthority agentTurnContextTrustClass = "runtime_system_authority"
	agentTurnContextTrustValidatedSource agentTurnContextTrustClass = "validated_source_data"
	agentTurnContextTrustRuntimeScoped   agentTurnContextTrustClass = "runtime_scoped_data"
	agentTurnContextTrustCallerInput     agentTurnContextTrustClass = "authenticated_caller_input"
	agentTurnContextTrustMixedRelation   agentTurnContextTrustClass = "validated_source_data+runtime_scoped_data"
)

type agentTurnContextTruncationClass string

const (
	agentTurnContextTruncationNone        agentTurnContextTruncationClass = "none"
	agentTurnContextTruncationHistory     agentTurnContextTruncationClass = "conversation_history_pair"
	agentTurnContextTruncationMemory      agentTurnContextTruncationClass = "canonical_memory_item"
	agentTurnContextTruncationExemplar    agentTurnContextTruncationClass = "dialogue_exemplar"
	agentTurnContextTruncationKnowledge   agentTurnContextTruncationClass = "source_knowledge_item"
	agentTurnContextTruncationWorldDetail agentTurnContextTruncationClass = "world_detail_item"
)

type agentTurnContextItemSourceRef struct {
	Kind          string `json:"kind"`
	WorldID       string `json:"worldId,omitempty"`
	RefID         string `json:"refId"`
	SchemaVersion string `json:"schemaVersion"`
	ContentHash   string `json:"contentHash"`
}

type agentTurnContextSegment struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type agentTurnContextMedia struct {
	MediaID     string `json:"mediaId"`
	Kind        string `json:"kind"`
	MIMEType    string `json:"mimeType"`
	ArtifactRef string `json:"artifactRef"`
}

type agentTurnContextItem struct {
	StableID        string
	LaneID          agentTurnContextLaneID
	SourcePath      string
	SourceRef       agentTurnContextItemSourceRef
	AuthorityOwner  agentTurnContextAuthority
	TrustClass      agentTurnContextTrustClass
	Priority        int64
	Rank            int64
	Mandatory       bool
	TruncationClass agentTurnContextTruncationClass
	Segments        []agentTurnContextSegment
	Media           []agentTurnContextMedia
	ContentHash     string
	TokenEstimate   uint64
	Included        bool
	Truncated       bool
}

type agentTurnContextLane struct {
	LaneID            agentTurnContextLaneID
	AuthorityOwner    agentTurnContextAuthority
	TrustClass        agentTurnContextTrustClass
	Items             []agentTurnContextItem
	AllocatedTokens   uint64
	UsedTokens        uint64
	IncludedItemCount uint32
	OmittedItemCount  uint32
	TruncatedCount    uint32
}

type agentTurnRuntimePolicyInput struct {
	PolicyID string `json:"policyId"`
	Version  string `json:"version"`
	Text     string `json:"text"`
}

type agentTurnOutputContractInput struct {
	ContractID string `json:"contractId"`
	Version    string `json:"version"`
	APML       string `json:"apml"`
}

type agentTurnRelationshipInput struct {
	RelationshipID string `json:"relationshipId"`
	Scope          string `json:"scope"`
	ProvenanceRef  string `json:"provenanceRef"`
	Summary        string `json:"summary"`
	Rank           int64  `json:"rank"`
}

type agentTurnMemoryInput struct {
	MemoryID      string `json:"memoryId"`
	Scope         string `json:"scope"`
	ProvenanceRef string `json:"provenanceRef"`
	Text          string `json:"text"`
	RelevanceRank int64  `json:"relevanceRank"`
}

type agentTurnTranscriptPairInput struct {
	TurnID        string `json:"turnId"`
	Sequence      uint64 `json:"sequence"`
	UserText      string `json:"userText"`
	AssistantText string `json:"assistantText"`
}

type agentTurnCapabilityInput struct {
	CapabilityID string `json:"capabilityId"`
	Kind         string `json:"kind"`
	Version      string `json:"version"`
	Description  string `json:"description"`
	Authorized   bool   `json:"authorized"`
	Ready        bool   `json:"ready"`
}

type agentTurnCurrentUserInput struct {
	Text  string                  `json:"text"`
	Media []agentTurnContextMedia `json:"media"`
}

type agentTurnContextBudgetInput struct {
	ContextWindowTokens   uint64
	ReservedOutputTokens  uint64
	ReservedSafetyTokens  uint64
	ReservedAdapterTokens uint64
}

type agentTurnContextRouteInput struct {
	RouteDigest           string
	CatalogRevisionDigest string
}

type agentTurnContextCompileInput struct {
	Snapshot             localAgentSourceSnapshotV1
	LocalAgentRef        string
	ConversationAnchorID string
	TurnID               string
	RequestID            string
	RuntimePolicy        []agentTurnRuntimePolicyInput
	OutputContract       agentTurnOutputContractInput
	Relationships        []agentTurnRelationshipInput
	Memory               []agentTurnMemoryInput
	Transcript           []agentTurnTranscriptPairInput
	Capabilities         []agentTurnCapabilityInput
	CurrentUserTurn      agentTurnCurrentUserInput
	Budget               agentTurnContextBudgetInput
	Route                agentTurnContextRouteInput
}

type agentTurnProviderMessage struct {
	Role    string                  `json:"role"`
	Content string                  `json:"content"`
	Media   []agentTurnContextMedia `json:"media,omitempty"`
}

type agentTurnProviderPrompt struct {
	Messages []agentTurnProviderMessage `json:"messages"`
}

type agentTurnContextBudgetManifestV1 struct {
	ContextWindowTokens   uint64 `json:"contextWindowTokens"`
	ReservedOutputTokens  uint64 `json:"reservedOutputTokens"`
	ReservedSafetyTokens  uint64 `json:"reservedSafetyTokens"`
	ReservedAdapterTokens uint64 `json:"reservedAdapterTokens"`
	InputBudgetTokens     uint64 `json:"inputBudgetTokens"`
	RequiredTokens        uint64 `json:"requiredTokens"`
	AllocatedTokens       uint64 `json:"allocatedTokens"`
	UsedTokens            uint64 `json:"usedTokens"`
}

type agentTurnContextLaneManifestV1 struct {
	LaneID             agentTurnContextLaneID          `json:"laneId"`
	AuthorityOwner     agentTurnContextAuthority       `json:"authorityOwner"`
	TrustClass         agentTurnContextTrustClass      `json:"trustClass"`
	SourceRefs         []agentTurnContextItemSourceRef `json:"sourceRefs"`
	ItemContentHashes  []string                        `json:"itemContentHashes"`
	ContentHash        string                          `json:"contentHash"`
	AllocatedTokens    uint64                          `json:"allocatedTokens"`
	UsedTokens         uint64                          `json:"usedTokens"`
	IncludedItemCount  uint32                          `json:"includedItemCount"`
	OmittedItemCount   uint32                          `json:"omittedItemCount"`
	TruncatedItemCount uint32                          `json:"truncatedItemCount"`
}

type agentTurnContextTranscriptManifestV1 struct {
	HeadTurnID         string `json:"headTurnId,omitempty"`
	TailTurnID         string `json:"tailTurnId,omitempty"`
	CommittedTurnCount uint32 `json:"committedTurnCount"`
	CommittedItemCount uint32 `json:"committedItemCount"`
}

type agentTurnContextManifestV1 struct {
	ManifestSchemaVersion      string                               `json:"manifestSchemaVersion"`
	CompilerSchemaVersion      string                               `json:"compilerSchemaVersion"`
	LocalAgentRef              string                               `json:"localAgentRef"`
	ConversationAnchorID       string                               `json:"conversationAnchorId"`
	TurnID                     string                               `json:"turnId"`
	RequestID                  string                               `json:"requestId"`
	SourceSnapshotHash         string                               `json:"sourceSnapshotHash"`
	SourceRef                  sourceMaterializationSourceRefV2     `json:"sourceRef"`
	WorldContentHash           string                               `json:"worldContentHash"`
	MaterializationContextHash string                               `json:"materializationContextHash"`
	RouteDigest                string                               `json:"routeDigest"`
	CatalogRevisionDigest      string                               `json:"catalogRevisionDigest"`
	Budget                     agentTurnContextBudgetManifestV1     `json:"budget"`
	Lanes                      []agentTurnContextLaneManifestV1     `json:"lanes"`
	CapabilityDigest           string                               `json:"capabilityDigest"`
	Transcript                 agentTurnContextTranscriptManifestV1 `json:"transcript"`
	MemoryItemCount            uint32                               `json:"memoryItemCount"`
	MediaCount                 uint32                               `json:"mediaCount"`
	ToolCount                  uint32                               `json:"toolCount"`
	ContextContentHash         string                               `json:"contextContentHash"`
	PromptHash                 string                               `json:"promptHash"`
	ManifestInstanceHash       string                               `json:"manifestInstanceHash"`
}

type agentTurnContextCompilation struct {
	Manifest       agentTurnContextManifestV1
	PrivateLanes   []agentTurnContextLane
	ProviderPrompt agentTurnProviderPrompt
	Summary        *runtimev1.AgentTurnContextSummary
}

type agentTurnContextCapacityExceededError struct {
	RequiredTokens  uint64
	AvailableTokens uint64
	BlockingLane    agentTurnContextLaneID
	Summary         *runtimev1.AgentTurnContextSummary
}

func (e *agentTurnContextCapacityExceededError) Error() string {
	if e == nil {
		return "context_capacity_exceeded"
	}
	return fmt.Sprintf("context_capacity_exceeded: required=%d available=%d blocking_lane=%s", e.RequiredTokens, e.AvailableTokens, e.BlockingLane)
}
