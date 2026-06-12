package runtimeagent

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
)

// K-DELEG-091 approval-request classification. Wave scope: declaration-driven
// derivation from the provider profile's K-DELEG-006 capability descriptor
// fields. Firewall output-content classification (K-DELEG-068 inspection of
// actual provider output) lands with the redaction pipeline; until then the
// detail records classification_basis=declared_expected so consumers can tell
// the basis apart instead of inferring inspection that never happened.

const (
	delegatedClassificationBasisDeclared = "declared_expected"
	delegatedClassificationBasisFirewall = "firewall_reviewed"
)

func deriveDelegatedToolEffectClass(profile *runtimev1.DelegatedProviderProfile, toolName string) runtimev1.EffectClass {
	entry := findDelegatedAllowlistEntry(profile, toolName)
	if entry == nil {
		return runtimev1.EffectClass_EFFECT_CLASS_UNSPECIFIED
	}
	return entry.GetEffectClass()
}

func deriveDelegatedToolExpectedSensitivity(profile *runtimev1.DelegatedProviderProfile, toolName string) runtimev1.SensitivityClass {
	entry := findDelegatedAllowlistEntry(profile, toolName)
	if entry == nil {
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_UNSPECIFIED
	}
	return entry.GetExpectedSensitivityClass()
}

func findDelegatedAllowlistEntry(profile *runtimev1.DelegatedProviderProfile, toolName string) *runtimev1.DelegatedToolAllowlistEntry {
	if profile == nil {
		return nil
	}
	name := strings.TrimSpace(toolName)
	if name == "" {
		return nil
	}
	for _, entry := range profile.GetAllowedTools() {
		if entry != nil && strings.TrimSpace(entry.GetToolName()) == name {
			return entry
		}
	}
	return nil
}

// effectiveDelegatedSensitivity collapses the conservative reading used by
// approval handling: an undeclared expectation cannot be proven safe, so it
// reads as UNKNOWN_SENSITIVE (K-DELEG-068 quarantine/approval class).
func effectiveDelegatedSensitivity(declared runtimev1.SensitivityClass) runtimev1.SensitivityClass {
	if declared == runtimev1.SensitivityClass_SENSITIVITY_CLASS_UNSPECIFIED {
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_UNKNOWN_SENSITIVE
	}
	return declared
}

// effectiveDelegatedEffectClass collapses an unclassified effect the same way
// sensitivity collapses: a tool whose effect cannot be proven (missing entry,
// or a profile persisted before K-DELEG-006 classification was required) must
// not surface as the UNSPECIFIED zero value, which K-DELEG-091 cannot carry and
// which the approval-resume gate would otherwise wave through. It reads as
// SENSITIVE_READ — the most restrictive non-unsupported effect, always
// approval-required per K-DELEG-007.
func effectiveDelegatedEffectClass(declared runtimev1.EffectClass) runtimev1.EffectClass {
	if declared == runtimev1.EffectClass_EFFECT_CLASS_UNSPECIFIED {
		return runtimev1.EffectClass_EFFECT_CLASS_SENSITIVE_READ
	}
	return declared
}

// classifyDelegatedApprovalDecisionLocked fills the K-DELEG-091 classification
// fields on an approval-required decision from the registered provider
// profile. Callers hold s.delegatedMu.
func (s *Service) classifyDelegatedApprovalDecisionLocked(decision *runtimeAgentDelegatedCapabilityDecision) {
	if s == nil || decision == nil {
		return
	}
	profile := s.delegatedProviderProfiles[delegatedProviderProfileKey(decision.AgentID, decision.ProviderID)]
	// Effect class is a pre-invocation property (K-DELEG-007); both paths read
	// it from the descriptor.
	decision.EffectClass = effectiveDelegatedEffectClass(deriveDelegatedToolEffectClass(profile, decision.ToolName))
	// Sensitivity basis differs by path: a post-firewall approval carries the
	// firewall's classification of the actual output; a pre-invoke approval has
	// no output yet and uses the descriptor's declared expectation.
	if firewall := strings.TrimSpace(decision.FirewallSensitivityClass); firewall != "" {
		decision.SensitivityClass = delegationSensitivityToProto(firewall)
		decision.ClassificationBasis = delegatedClassificationBasisFirewall
	} else {
		decision.SensitivityClass = effectiveDelegatedSensitivity(deriveDelegatedToolExpectedSensitivity(profile, decision.ToolName))
		decision.ClassificationBasis = delegatedClassificationBasisDeclared
	}
	decision.SummaryRef = delegatedApprovalSummaryRef(decision)
}

// delegationSensitivityToProto maps the delegation package's wire sensitivity
// string back to the proto enum; an unknown value collapses to
// UNKNOWN_SENSITIVE (fail-closed, K-DELEG-068).
func delegationSensitivityToProto(class string) runtimev1.SensitivityClass {
	switch class {
	case delegation.SensitivityClassNone:
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_NONE
	case delegation.SensitivityClassUserPrivate:
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_USER_PRIVATE
	case delegation.SensitivityClassCredentialLike:
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_CREDENTIAL_LIKE
	case delegation.SensitivityClassOrgPrivate:
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_ORG_PRIVATE
	case delegation.SensitivityClassRegulated:
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_REGULATED
	default:
		return runtimev1.SensitivityClass_SENSITIVITY_CLASS_UNKNOWN_SENSITIVE
	}
}

// delegatedFirewallClassificationInputs resolves the effect class and trust
// tier the firewall needs for its K-DELEG-069 approval-requirement derivation,
// from the registered provider profile. Unknown profile/tool yields an empty
// trust tier, which the firewall treats fail-closed.
func (s *Service) delegatedFirewallClassificationInputs(agentID string, providerID string, toolName string) (effectClass string, trustTier string) {
	if s == nil {
		return "", ""
	}
	s.delegatedMu.RLock()
	defer s.delegatedMu.RUnlock()
	profile := s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, providerID)]
	effect := effectiveDelegatedEffectClass(deriveDelegatedToolEffectClass(profile, toolName))
	return delegatedEffectClassWire(effect), delegatedTrustTierWire(profile.GetTrustTier())
}

// delegatedEffectClassWire maps the proto EffectClass enum onto the delegation
// package's wire string; UNSPECIFIED maps to empty (fail-closed).
func delegatedEffectClassWire(effect runtimev1.EffectClass) string {
	switch effect {
	case runtimev1.EffectClass_EFFECT_CLASS_READ_ONLY:
		return delegation.EffectClassReadOnly
	case runtimev1.EffectClass_EFFECT_CLASS_LOCAL_SIDE_EFFECT:
		return delegation.EffectClassLocalSideEffect
	case runtimev1.EffectClass_EFFECT_CLASS_EXTERNAL_SIDE_EFFECT:
		return delegation.EffectClassExternalSideEffect
	case runtimev1.EffectClass_EFFECT_CLASS_SENSITIVE_READ:
		return delegation.EffectClassSensitiveRead
	case runtimev1.EffectClass_EFFECT_CLASS_UNSUPPORTED_EFFECT:
		return delegation.EffectClassUnsupportedEffect
	default:
		return ""
	}
}

// delegatedTrustTierWire maps the proto trust tier enum onto the delegation
// package's wire string; UNSPECIFIED maps to empty (fail-closed).
func delegatedTrustTierWire(tier runtimev1.DelegatedProviderTrustTier) string {
	switch tier {
	case runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_CONTROLLED_LOCAL:
		return delegation.TrustTierControlledLocal
	case runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_USER_ADDED_REVIEWED:
		return delegation.TrustTierUserAddedReviewed
	case runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_ORG_MANAGED:
		return delegation.TrustTierOrgManaged
	case runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_BLOCKED:
		return delegation.TrustTierBlocked
	default:
		return ""
	}
}

// delegatedApprovalSummaryRef is a self-describing pointer into the approval
// record's own detail.summary field; it resolves without a second store.
func delegatedApprovalSummaryRef(decision *runtimeAgentDelegatedCapabilityDecision) string {
	if decision == nil {
		return ""
	}
	return "delegated-approval:" + strings.TrimSpace(decision.DecisionID) + "#summary"
}

func delegatedApprovalSummaryText(decision *runtimeAgentDelegatedCapabilityDecision) string {
	if decision == nil {
		return ""
	}
	return fmt.Sprintf(
		"provider=%s capability=%s tool=%s effect=%s sensitivity=%s firewall=%s",
		strings.TrimSpace(decision.ProviderID),
		strings.TrimSpace(decision.CapabilityID),
		strings.TrimSpace(decision.ToolName),
		decision.EffectClass.String(),
		decision.SensitivityClass.String(),
		strings.TrimSpace(decision.FirewallVerdict),
	)
}
