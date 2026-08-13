package delegation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

const defaultAcceptedOutputLimit = 64 * 1024

type FirewallPolicy struct {
	MinObservationConfidence string
	MaxAcceptedOutputBytes   int
	ThreatRules              []ThreatRule
}

type ThreatRule struct {
	ID      string
	Family  string
	Pattern *regexp.Regexp
}

// @nimi-authority: definition.nimi.runtime.delegation.output-firewall-plane
// @nimi-authority: rule.nimi.runtime.delegation.r029
type Firewall struct {
	policy FirewallPolicy
	now    func() time.Time
}

type FirewallOption func(*Firewall)

func WithFirewallClock(now func() time.Time) FirewallOption {
	return func(f *Firewall) {
		if now != nil {
			f.now = now
		}
	}
}

func NewFirewall(policy FirewallPolicy, opts ...FirewallOption) (*Firewall, error) {
	if policy.MinObservationConfidence == "" {
		policy.MinObservationConfidence = ConfidenceLevelMedium
	}
	if !knownConfidenceLevel(policy.MinObservationConfidence) {
		return nil, fmt.Errorf("unknown minimum confidence level %q", policy.MinObservationConfidence)
	}
	if policy.MaxAcceptedOutputBytes <= 0 {
		policy.MaxAcceptedOutputBytes = defaultAcceptedOutputLimit
	}
	if len(policy.ThreatRules) == 0 {
		policy.ThreatRules = defaultThreatRules()
	}
	for _, rule := range policy.ThreatRules {
		if strings.TrimSpace(rule.ID) == "" || strings.TrimSpace(rule.Family) == "" || rule.Pattern == nil {
			return nil, errors.New("firewall threat rules require id, family, and pattern")
		}
	}
	f := &Firewall{
		policy: policy,
		now:    func() time.Time { return time.Now().UTC() },
	}
	for _, opt := range opts {
		opt(f)
	}
	return f, nil
}

func (f *Firewall) Evaluate(ctx context.Context, input FirewallInput) (*FirewallDecision, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	base := f.baseDecision(input)
	if input.StreamTerminalError {
		return f.reject(base, FirewallVerdictRejected, ReasonStreamTerminalError, nil), nil
	}
	if input.Evidence == nil {
		return f.reject(base, FirewallVerdictSchemaInvalid, ReasonFirewallSchemaInvalid, nil), nil
	}
	if input.Evidence.State != EvidenceStateQuarantined || input.Evidence.FirewallState != FirewallStateNotEvaluated {
		return f.reject(base, FirewallVerdictSchemaInvalid, ReasonFirewallSchemaInvalid, nil), nil
	}
	if input.Evidence.ModelContextAdmitted || input.Evidence.ProjectionAdmitted || input.Evidence.ActionAdmitted {
		return f.reject(base, FirewallVerdictPolicyBlocked, ReasonFirewallQuarantined, nil), nil
	}
	if !requiredLineagePresent(input) {
		return f.reject(base, FirewallVerdictSchemaInvalid, ReasonFirewallSchemaInvalid, nil), nil
	}
	if !f.provenanceMatches(input) {
		return f.reject(base, FirewallVerdictProviderDrifted, ReasonProviderDrifted, nil), nil
	}
	if input.Evidence.ToolError {
		return f.reject(base, FirewallVerdictRejected, ReasonFirewallQuarantined, nil), nil
	}
	payload, err := decodeEvidencePayload(input.Evidence.RawProviderResult)
	if err != nil {
		return f.reject(base, FirewallVerdictSchemaInvalid, ReasonFirewallSchemaInvalid, nil), nil
	}
	normalized, err := normalizeEvidencePayload(payload)
	if err != nil || len(normalized) > f.policy.MaxAcceptedOutputBytes {
		return f.reject(base, FirewallVerdictSchemaInvalid, ReasonFirewallSchemaInvalid, nil), nil
	}
	indicators := f.detectThreats(payload)
	if len(indicators) > 0 {
		base.ThreatIndicators = indicators
		return f.reject(base, FirewallVerdictPolicyBlocked, ReasonFirewallQuarantined, indicators), nil
	}
	if !confidenceMeets(input.Confidence, f.policy.MinObservationConfidence) {
		return f.reject(base, FirewallVerdictQuarantined, ReasonFirewallQuarantined, nil), nil
	}
	base.NormalizedOutput = normalized
	// K-DELEG-068: classify the actual provider output content.
	base.SensitivityClass = classifySensitiveData(payload)
	// K-DELEG-069: derive the approval requirement from effect class, the
	// classified sensitivity, confidence, and provider trust tier.
	requirement := deriveApprovalRequirement(
		input.EffectClass,
		base.SensitivityClass,
		input.Confidence,
		input.TrustTier,
		input.RequiresApproval,
	)
	base.ApprovalRequirement = requirement
	if requirement == ApprovalRequirementPolicyBlocked {
		return f.reject(base, FirewallVerdictPolicyBlocked, ReasonFirewallQuarantined, nil), nil
	}
	switch input.OutputKind {
	case OutputKindObservation:
		base.Verdict = FirewallVerdictAcceptedObservation
	case OutputKindSuggestedIntent, OutputKindSuggestedPresentation:
		base.Verdict = FirewallVerdictAcceptedSuggestion
	case OutputKindSuggestedToolRequest:
		// A tool request is always an action proposal; it requires approval
		// regardless of the derived requirement for observation/suggestion.
		base.Verdict = FirewallVerdictApprovalRequired
		base.ReasonCode = ReasonApprovalRequired
		base.ApprovalRequirement = ApprovalRequirementRequired
		return base, nil
	default:
		return f.reject(base, FirewallVerdictSchemaInvalid, ReasonFirewallSchemaInvalid, nil), nil
	}
	if requirement == ApprovalRequirementRequired {
		base.Verdict = FirewallVerdictApprovalRequired
		base.ReasonCode = ReasonApprovalRequired
	}
	return base, nil
}

func (f *Firewall) baseDecision(input FirewallInput) *FirewallDecision {
	return &FirewallDecision{
		FirewallInputID:    strings.TrimSpace(input.FirewallInputID),
		DelegationResultID: strings.TrimSpace(input.DelegationResultID),
		ProviderProfileID:  strings.TrimSpace(input.ProviderProfileID),
		CapabilityID:       strings.TrimSpace(input.CapabilityID),
		Confidence:         input.Confidence,
		Provenance:         input.Provenance,
		CreatedAt:          f.now(),
	}
}

func (f *Firewall) reject(base *FirewallDecision, verdict string, reasonCode string, indicators []ThreatIndicator) *FirewallDecision {
	base.Verdict = verdict
	base.ReasonCode = reasonCode
	base.ThreatIndicators = indicators
	base.ModelContextAdmitted = false
	base.ProjectionAdmitted = false
	base.ActionAdmitted = false
	return base
}

func requiredLineagePresent(input FirewallInput) bool {
	if strings.TrimSpace(input.FirewallInputID) == "" ||
		strings.TrimSpace(input.DelegationResultID) == "" ||
		strings.TrimSpace(input.CandidateOutputRef) == "" ||
		strings.TrimSpace(input.ProviderProfileID) == "" ||
		strings.TrimSpace(input.CapabilityID) == "" ||
		strings.TrimSpace(input.DescriptorHash) == "" ||
		strings.TrimSpace(input.ProtocolName) == "" ||
		strings.TrimSpace(input.ProtocolRevision) == "" ||
		input.ReceivedAt.IsZero() {
		return false
	}
	return strings.TrimSpace(input.Provenance.ProvenanceID) != "" &&
		strings.TrimSpace(input.Provenance.ProviderProfileID) != "" &&
		strings.TrimSpace(input.Provenance.CapabilityID) != "" &&
		strings.TrimSpace(input.Provenance.DelegationRequestID) != "" &&
		strings.TrimSpace(input.Provenance.DelegationResultID) != "" &&
		strings.TrimSpace(input.Provenance.DescriptorHash) != "" &&
		strings.TrimSpace(input.Provenance.ProtocolName) != "" &&
		strings.TrimSpace(input.Provenance.ProtocolRevision) != "" &&
		!input.Provenance.ReceivedAt.IsZero()
}

func (f *Firewall) provenanceMatches(input FirewallInput) bool {
	if strings.TrimSpace(input.ProviderProfileID) == "" ||
		strings.TrimSpace(input.CapabilityID) == "" ||
		strings.TrimSpace(input.DelegationResultID) == "" ||
		strings.TrimSpace(input.DescriptorHash) == "" {
		return false
	}
	if input.Provenance.ProviderProfileID != input.ProviderProfileID ||
		input.Provenance.CapabilityID != input.CapabilityID ||
		input.Provenance.DelegationResultID != input.DelegationResultID ||
		input.Provenance.DescriptorHash != input.DescriptorHash {
		return false
	}
	if input.ProtocolName != "" && input.Provenance.ProtocolName != input.ProtocolName {
		return false
	}
	if input.ProtocolRevision != "" && input.Provenance.ProtocolRevision != input.ProtocolRevision {
		return false
	}
	if input.Evidence.ProviderID != input.ProviderProfileID || input.Evidence.InputSchemaDigest != input.DescriptorHash {
		return false
	}
	return true
}

func (f *Firewall) detectThreats(payload delegatedEvidencePayload) []ThreatIndicator {
	var indicators []ThreatIndicator
	for _, text := range jsonStringTokens(payload.Content, payload.StructuredContent) {
		normalized := strings.Join(strings.Fields(text), " ")
		for _, rule := range f.policy.ThreatRules {
			match := rule.Pattern.FindString(normalized)
			if match == "" {
				continue
			}
			indicators = append(indicators, ThreatIndicator{
				ID:      rule.ID,
				Family:  rule.Family,
				Pattern: rule.Pattern.String(),
				Excerpt: excerpt(normalized, match),
			})
		}
	}
	return indicators
}

func decodeEvidencePayload(raw json.RawMessage) (delegatedEvidencePayload, error) {
	var payload delegatedEvidencePayload
	if len(raw) == 0 {
		return payload, errors.New("empty delegated evidence payload")
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return payload, err
	}
	if len(payload.Content) == 0 && len(payload.StructuredContent) == 0 {
		return payload, errors.New("delegated evidence payload has no content")
	}
	if !json.Valid(payload.Content) && !json.Valid(payload.StructuredContent) {
		return payload, errors.New("delegated evidence payload content is invalid")
	}
	return payload, nil
}

func normalizeEvidencePayload(payload delegatedEvidencePayload) (json.RawMessage, error) {
	normalized := struct {
		Content           json.RawMessage `json:"content,omitempty"`
		StructuredContent json.RawMessage `json:"structured_content,omitempty"`
	}{
		Content:           payload.Content,
		StructuredContent: payload.StructuredContent,
	}
	return json.Marshal(normalized)
}

func jsonStringTokens(values ...json.RawMessage) []string {
	var out []string
	for _, raw := range values {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		for {
			token, err := decoder.Token()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				break
			}
			if value, ok := token.(string); ok {
				out = append(out, value)
			}
		}
	}
	return out
}

func confidenceMeets(confidence ConfidenceRecord, minimum string) bool {
	if confidence.EvidenceCount <= 0 {
		return false
	}
	if confidence.Reason == ConfidenceReasonInsufficientEvidence || confidence.Reason == "" {
		return false
	}
	return confidenceRank(confidence.Level) >= confidenceRank(minimum)
}

func confidenceRank(level string) int {
	switch level {
	case ConfidenceLevelHigh:
		return 3
	case ConfidenceLevelMedium:
		return 2
	case ConfidenceLevelLow:
		return 1
	default:
		return 0
	}
}

func knownConfidenceLevel(level string) bool {
	return confidenceRank(level) > 0 || level == ConfidenceLevelUnsupported
}

func defaultThreatRules() []ThreatRule {
	return []ThreatRule{
		mustThreatRule("prompt-injection-ignore", "PROMPT_INJECTION", `(?i)\bignore\s+(all\s+)?(previous|prior|system|developer)\s+instructions\b`),
		mustThreatRule("prompt-injection-role", "PROMPT_INJECTION", `(?i)\b(system|developer)\s+(prompt|message|instructions?)\b`),
		mustThreatRule("tool-poisoning-secret", "TOOL_POISONING", `(?i)\b(exfiltrate|leak|send|forward)\b.{0,80}\b(token|secret|api[_ -]?key|authorization)\b`),
		mustThreatRule("tool-poisoning-bypass", "TOOL_POISONING", `(?i)\b(bypass|disable|override)\b.{0,80}\b(approval|permission|policy|firewall)\b`),
		mustThreatRule("unsafe-action-transfer", "UNSAFE_ACTION", `(?i)\b(transfer|purchase|delete|send email|place order)\b.{0,80}\b(without approval|without confirmation|automatically)\b`),
	}
}

func mustThreatRule(id string, family string, pattern string) ThreatRule {
	return ThreatRule{ID: id, Family: family, Pattern: regexp.MustCompile(pattern)}
}

func excerpt(text string, match string) string {
	index := strings.Index(strings.ToLower(text), strings.ToLower(match))
	if index < 0 {
		return match
	}
	start := index - 48
	if start < 0 {
		start = 0
	}
	end := index + len(match) + 48
	if end > len(text) {
		end = len(text)
	}
	return text[start:end]
}
