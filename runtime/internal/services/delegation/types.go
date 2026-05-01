package delegation

import (
	"encoding/json"
	"time"
)

const (
	ProviderKindMCPToolProvider = "MCP_TOOL_PROVIDER"
	TransportKindStdioCommand   = "stdio_command"

	ProviderStateActive   = "ACTIVE"
	ProviderStateDisabled = "DISABLED"

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
)

type ProviderProfile struct {
	ID                string
	Name              string
	ProviderKind      string
	TransportKind     string
	State             string
	Command           string
	Args              []string
	AllowedTools      []ToolAllowlistEntry
	Timeout           time.Duration
	TerminateDuration time.Duration
}

type ToolAllowlistEntry struct {
	Name              string
	InputSchemaDigest string
}

type ToolDescriptor struct {
	Name              string
	Title             string
	Description       string
	InputSchemaDigest string
	Allowed           bool
}

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
	RawMCPResult          json.RawMessage
	StartedAt             time.Time
	CompletedAt           time.Time
	Duration              time.Duration
	ProtocolAdapter       string
	ProtocolAdapterSource string
}

type mcpToolCallEvidencePayload struct {
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
