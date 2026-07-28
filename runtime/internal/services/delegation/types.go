package delegation

import (
	"encoding/json"
	"time"
)

const (
	FirewallStateNotEvaluated          = "not_evaluated"
	FirewallVerdictAcceptedObservation = "ACCEPTED_OBSERVATION"
	FirewallVerdictAcceptedSuggestion  = "ACCEPTED_SUGGESTION"
	FirewallVerdictApprovalRequired    = "APPROVAL_REQUIRED"
	FirewallVerdictQuarantined         = "QUARANTINED"
	FirewallVerdictRejected            = "REJECTED"
	FirewallVerdictProviderDrifted     = "PROVIDER_DRIFTED"
	FirewallVerdictSchemaInvalid       = "SCHEMA_INVALID"
	FirewallVerdictPolicyBlocked       = "POLICY_BLOCKED"

	EvidenceStateQuarantined = "quarantined"

	OutputKindObservation           = "OBSERVATION"
	OutputKindSuggestedIntent       = "SUGGESTED_INTENT"
	OutputKindSuggestedToolRequest  = "SUGGESTED_TOOL_REQUEST"
	OutputKindSuggestedPresentation = "SUGGESTED_PRESENTATION"

	ConfidenceLevelHigh        = "HIGH"
	ConfidenceLevelMedium      = "MEDIUM"
	ConfidenceLevelLow         = "LOW"
	ConfidenceLevelUnsupported = "UNSUPPORTED"

	ConfidenceReasonProviderEvidence     = "PROVIDER_EVIDENCE"
	ConfidenceReasonControlledFixture    = "CONTROLLED_FIXTURE"
	ConfidenceReasonInsufficientEvidence = "INSUFFICIENT_EVIDENCE"
	ConfidenceReasonPolicyDowngrade      = "POLICY_DOWNGRADE"

	ReasonFirewallSchemaInvalid = "DELEG_FIREWALL_SCHEMA_INVALID"
	ReasonFirewallQuarantined   = "DELEG_FIREWALL_QUARANTINED"
	ReasonProviderDrifted       = "DELEG_PROVIDER_DRIFTED"
	ReasonApprovalRequired      = "DELEG_APPROVAL_REQUIRED"
	ReasonStreamTerminalError   = "DELEG_STREAM_TERMINAL_ERROR"
	// Admitted Runtime delegation reason codes.
	ReasonProviderNotFound     = "DELEG_PROVIDER_NOT_FOUND"
	ReasonProviderBlocked      = "DELEG_PROVIDER_BLOCKED"
	ReasonCapabilityNotAllowed = "DELEG_CAPABILITY_NOT_ALLOWED"
	ReasonRequestSchemaInvalid = "DELEG_REQUEST_SCHEMA_INVALID"
	ReasonProviderTimeout      = "DELEG_PROVIDER_TIMEOUT"
	// K-DELEG-007 effect classification (mirrors proto EffectClass without the
	// wire enum prefix). Empty string means unclassified and is treated
	// fail-closed by approval-requirement derivation.
	EffectClassReadOnly           = "READ_ONLY"
	EffectClassLocalSideEffect    = "LOCAL_SIDE_EFFECT"
	EffectClassExternalSideEffect = "EXTERNAL_SIDE_EFFECT"
	EffectClassSensitiveRead      = "SENSITIVE_READ"
	EffectClassUnsupportedEffect  = "UNSUPPORTED_EFFECT"

	// K-DELEG-068 sensitive output classification.
	SensitivityClassNone             = "NONE"
	SensitivityClassUserPrivate      = "USER_PRIVATE"
	SensitivityClassCredentialLike   = "CREDENTIAL_LIKE"
	SensitivityClassOrgPrivate       = "ORG_PRIVATE"
	SensitivityClassRegulated        = "REGULATED"
	SensitivityClassUnknownSensitive = "UNKNOWN_SENSITIVE"

	// Provider trust tier (mirrors proto DelegatedProviderTrustTier). Empty
	// string means unknown tier and is treated fail-closed.
	TrustTierControlledLocal   = "CONTROLLED_LOCAL"
	TrustTierUserAddedReviewed = "USER_ADDED_REVIEWED"
	TrustTierOrgManaged        = "ORG_MANAGED"
	TrustTierBlocked           = "BLOCKED"

	// K-DELEG-069 approval requirement derivation result.
	ApprovalRequirementNotRequired   = "NOT_REQUIRED"
	ApprovalRequirementRequired      = "REQUIRED"
	ApprovalRequirementPolicyBlocked = "POLICY_BLOCKED"
)

type ToolCallRequest struct {
	ProviderID string
	ToolName   string
	Arguments  json.RawMessage
	TraceID    string
}

type QuarantinedEvidence struct {
	EvidenceID            string
	ProviderID            string
	ToolName              string
	TraceID               string
	State                 string
	FirewallState         string
	ModelContextAdmitted  bool
	ProjectionAdmitted    bool
	ActionAdmitted        bool
	ToolError             bool
	InputSchemaDigest     string
	RawProviderResult     json.RawMessage
	StartedAt             time.Time
	CompletedAt           time.Time
	Duration              time.Duration
	ProtocolAdapter       string
	ProtocolAdapterSource string
}

type delegatedEvidencePayload struct {
	Content           json.RawMessage `json:"content,omitempty"`
	StructuredContent json.RawMessage `json:"structured_content,omitempty"`
	IsError           bool            `json:"is_error,omitempty"`
}

type FirewallInput struct {
	FirewallInputID     string
	DelegationResultID  string
	CandidateOutputRef  string
	ProviderProfileID   string
	CapabilityID        string
	DescriptorHash      string
	ProtocolName        string
	ProtocolRevision    string
	OutputKind          string
	RequiresApproval    bool
	EffectClass         string
	TrustTier           string
	Confidence          ConfidenceRecord
	Provenance          ProvenanceRecord
	StreamSegmentKind   string
	StreamTerminalError bool
	Evidence            *QuarantinedEvidence
	ReceivedAt          time.Time
}

type ProvenanceRecord struct {
	ProvenanceID        string
	ProviderProfileID   string
	CapabilityID        string
	DelegationRequestID string
	DelegationResultID  string
	DescriptorHash      string
	ProtocolName        string
	ProtocolRevision    string
	ReceivedAt          time.Time
}

type ConfidenceRecord struct {
	Level                    string
	Score                    string
	EvidenceCount            int
	RequiresUserConfirmation bool
	Reason                   string
}

type FirewallDecision struct {
	FirewallInputID      string
	DelegationResultID   string
	ProviderProfileID    string
	CapabilityID         string
	ToolName             string
	Verdict              string
	ReasonCode           string
	SensitivityClass     string
	ApprovalRequirement  string
	Confidence           ConfidenceRecord
	Provenance           ProvenanceRecord
	ThreatIndicators     []ThreatIndicator
	NormalizedOutput     json.RawMessage
	ModelContextAdmitted bool
	ProjectionAdmitted   bool
	ActionAdmitted       bool
	CreatedAt            time.Time
}

type ThreatIndicator struct {
	ID      string
	Family  string
	Pattern string
	Excerpt string
}
