package delegation

import (
	"regexp"
	"strings"
)

// K-DELEG-068 sensitive-output classification + K-DELEG-069 approval-requirement
// derivation. Classification inspects the actual provider output content (not
// the declared capability descriptor); derivation combines effect class,
// sensitivity class, confidence, and provider trust tier and fails closed on
// any dimension it cannot prove.
//
// K-DELEG-069 lists six derivation inputs; this implementation consumes four
// (effect class, sensitivity, confidence, trust tier). The remaining two —
// policy snapshot and user/organization rule — are deferred pending a policy
// engine; the policy snapshot id is still recorded on the approval record for
// lineage. ORG_PRIVATE detection likewise needs an organization-data corpus a
// regex cannot supply and is therefore not emitted by the content classifier;
// content that is high-entropy-secret-shaped but not a recognized credential
// format collapses to UNKNOWN_SENSITIVE (fail-closed).

var (
	// Recognized credential formats: keyword=value pairs (the trailing value is
	// required so "password:" alone does not match, and the prior trailing-\b
	// bug that dropped the colon form is gone), bearer tokens, PEM private keys,
	// and well-known vendor token shapes (AWS, GitHub/GitLab, OpenAI-style,
	// Slack, Google, JWT).
	credentialKeywordPattern = regexp.MustCompile(`(?i)\b(api[_ -]?key|secret[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token|token|client[_ -]?secret|password|passwd|authorization)\b\s*[:=]\s*\S`)
	credentialBearerPattern  = regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._\-]{8,}`)
	credentialPemPattern     = regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`)
	credentialVendorPattern  = regexp.MustCompile(`\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|(ghp|gho|ghu|ghs|ghr|glpat)_[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9\-]{10,}|AIza[0-9A-Za-z_\-]{35}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{6,})\b`)
	regulatedPattern         = regexp.MustCompile(`(?i)(\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,16}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b)`)
	userPrivatePattern       = regexp.MustCompile(`(?i)(\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\b\+?\d[\d ().-]{7,}\d\b)`)
	highEntropyTokenPattern  = regexp.MustCompile(`\b[A-Za-z0-9+/=_\-]{32,}\b`)
)

// classifySensitiveData returns the highest sensitivity class detected across
// the payload's string tokens. No match is NONE; the caller decides how NONE
// interacts with effect class and trust tier.
func classifySensitiveData(payload delegatedEvidencePayload) string {
	highest := SensitivityClassNone
	for _, text := range jsonStringTokens(payload.Content, payload.StructuredContent) {
		normalized := strings.Join(strings.Fields(text), " ")
		highest = maxSensitivity(highest, classifyTokenSensitivity(normalized))
	}
	return highest
}

func classifyTokenSensitivity(text string) string {
	switch {
	case credentialKeywordPattern.MatchString(text),
		credentialBearerPattern.MatchString(text),
		credentialPemPattern.MatchString(text),
		credentialVendorPattern.MatchString(text):
		return SensitivityClassCredentialLike
	case regulatedPattern.MatchString(text):
		return SensitivityClassRegulated
	case containsHighEntropySecret(text):
		// Secret-shaped but unrecognized format: cannot be proven safe.
		return SensitivityClassUnknownSensitive
	case userPrivatePattern.MatchString(text):
		return SensitivityClassUserPrivate
	default:
		return SensitivityClassNone
	}
}

// containsHighEntropySecret flags a token-set string member that looks like an
// opaque secret: a long base64/token-charset run mixing character classes.
// Pure-hex digests (e.g. sha256) lack the uppercase+lowercase mix and are not
// flagged, so content hashes do not over-trigger; mixed-case high-entropy keys
// (AWS secret access keys and similar) do.
func containsHighEntropySecret(text string) bool {
	for _, candidate := range highEntropyTokenPattern.FindAllString(text, -1) {
		var hasLower, hasUpper, hasDigit bool
		for _, r := range candidate {
			switch {
			case r >= 'a' && r <= 'z':
				hasLower = true
			case r >= 'A' && r <= 'Z':
				hasUpper = true
			case r >= '0' && r <= '9':
				hasDigit = true
			}
		}
		if hasLower && hasUpper && hasDigit {
			return true
		}
	}
	return false
}

func sensitivityRank(class string) int {
	switch class {
	case SensitivityClassCredentialLike:
		return 5
	case SensitivityClassRegulated:
		return 4
	case SensitivityClassUnknownSensitive:
		return 3
	case SensitivityClassOrgPrivate:
		return 2
	case SensitivityClassUserPrivate:
		return 1
	default:
		return 0
	}
}

func maxSensitivity(a string, b string) string {
	if sensitivityRank(b) > sensitivityRank(a) {
		return b
	}
	return a
}

// deriveApprovalRequirement implements K-DELEG-069. Ordering encodes the
// fail-closed posture: hard blocks first, then unprovable inputs, then the
// sensitivity/effect escalations, then caller/confidence escalation, with
// NOT_REQUIRED reachable only when every dimension is proven low-risk.
func deriveApprovalRequirement(
	effectClass string,
	sensitivityClass string,
	confidence ConfidenceRecord,
	trustTier string,
	callerRequiresApproval bool,
) string {
	if trustTier == TrustTierBlocked {
		return ApprovalRequirementPolicyBlocked
	}
	if effectClass == EffectClassUnsupportedEffect {
		return ApprovalRequirementPolicyBlocked
	}
	// An effect or trust tier we cannot read cannot be proven safe.
	if strings.TrimSpace(effectClass) == "" || strings.TrimSpace(trustTier) == "" {
		return ApprovalRequirementRequired
	}
	// K-DELEG-068: credential-like, regulated, and unknown-sensitive output
	// requires quarantine or explicit approval before further use.
	switch sensitivityClass {
	case SensitivityClassCredentialLike, SensitivityClassRegulated, SensitivityClassUnknownSensitive:
		return ApprovalRequirementRequired
	}
	// K-DELEG-007: external side effects and sensitive reads require approval.
	switch effectClass {
	case EffectClassExternalSideEffect, EffectClassSensitiveRead:
		return ApprovalRequirementRequired
	}
	if callerRequiresApproval || confidence.RequiresUserConfirmation {
		return ApprovalRequirementRequired
	}
	// User/org-private output on a low-risk effect may proceed without approval
	// only from a controlled-local provider; any weaker tier requires approval.
	if sensitivityClass == SensitivityClassUserPrivate || sensitivityClass == SensitivityClassOrgPrivate {
		if trustTier == TrustTierControlledLocal {
			return ApprovalRequirementNotRequired
		}
		return ApprovalRequirementRequired
	}
	return ApprovalRequirementNotRequired
}
