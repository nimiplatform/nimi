// Package appsafety carries the publisher safety declaration
// (nimi.app.yaml safety_profile) as declared through Registry descriptors,
// package information and installed snapshots. Runtime validates its closed
// vocabulary and structure, never fills or infers a value, and never turns it
// into access, a session condition or an eligibility decision.
package appsafety

import (
	"encoding/json"
	"errors"
	"fmt"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043c

const MaxBytes = 16 * 1024

var ErrInvalidProfile = errors.New("invalid App safety declaration")

type Output struct {
	Modality               string `json:"modality" yaml:"modality"`
	Exposure               string `json:"exposure" yaml:"exposure"`
	PublicationControl     string `json:"publication_control" yaml:"publication_control"`
	InProductNotice        string `json:"in_product_notice" yaml:"in_product_notice"`
	ExportVisibleMarking   string `json:"export_visible_marking" yaml:"export_visible_marking"`
	MachineReadableMarking string `json:"machine_readable_marking" yaml:"machine_readable_marking"`
}

type AI struct {
	// Pointer so a missing field is distinguishable from a declared false.
	DirectInteraction *bool    `json:"direct_interaction" yaml:"direct_interaction"`
	InteractionNotice string   `json:"interaction_notice" yaml:"interaction_notice"`
	RiskFeatures      []string `json:"risk_features" yaml:"risk_features"`
	SubjectNotice     string   `json:"subject_notice" yaml:"subject_notice"`
	Outputs           []Output `json:"outputs" yaml:"outputs"`
}

type DataPractices struct {
	// Pointer so a missing field is distinguishable from a declared false.
	PublisherDirectExternalNetwork *bool    `json:"publisher_direct_external_network" yaml:"publisher_direct_external_network"`
	Telemetry                      []string `json:"telemetry" yaml:"telemetry"`
	ThirdPartyAccount              string   `json:"third_party_account" yaml:"third_party_account"`
	UserContentSharing             string   `json:"user_content_sharing" yaml:"user_content_sharing"`
	CommercialFeatures             []string `json:"commercial_features" yaml:"commercial_features"`
	SensitiveDataCategories        []string `json:"sensitive_data_categories" yaml:"sensitive_data_categories"`
}

type Profile struct {
	IntendedAudience       string        `json:"intended_audience" yaml:"intended_audience"`
	ContentDescriptors     []string      `json:"content_descriptors" yaml:"content_descriptors"`
	AI                     AI            `json:"ai" yaml:"ai"`
	DataPractices          DataPractices `json:"data_practices" yaml:"data_practices"`
	HighImpactDecisionUses []string      `json:"high_impact_decision_uses" yaml:"high_impact_decision_uses"`
}

var (
	audiences         = set("children", "general", "teen", "adult")
	descriptors       = set("sexual-content", "violence", "self-harm", "drugs-alcohol", "gambling", "hate-harassment", "frightening-content", "strong-language", "unmoderated-shared-content")
	riskFeatures      = set("realistic-face-manipulation", "realistic-voice-replication", "emotion-recognition", "biometric-categorization")
	modalities        = set("text", "image", "audio", "video", "virtual-scene")
	exposures         = set("in-app-only", "exportable", "publishable")
	publicationValues = set("user-confirmed", "automatic")
	presence          = set("present", "absent")
	telemetry         = set("crash-diagnostics", "usage-analytics")
	accounts          = set("none", "optional", "required")
	sharing           = set("none", "private", "public")
	commercial        = set("purchase", "subscription", "advertising")
	sensitive         = set("precise-location", "contacts", "health", "financial", "biometric", "government-identifier")
	highImpact        = set("medical-diagnosis-treatment", "legal-decision-support", "employment-decision", "education-admission-decision", "credit-insurance-decision", "biometric-identification", "public-safety-decision")
	subjectTriggers   = set("emotion-recognition", "biometric-categorization")
)

// Bool builds a declared boolean value.
func Bool(value bool) *bool {
	return &value
}

func set(values ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func invalid(field string) error {
	return fmt.Errorf("%s: %w", field, ErrInvalidProfile)
}

func member(value string, vocabulary map[string]struct{}) bool {
	_, ok := vocabulary[value]
	return ok
}

func list(values []string, vocabulary map[string]struct{}) bool {
	if values == nil {
		return false
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !member(value, vocabulary) {
			return false
		}
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

// Validate accepts a nil profile (undeclared) and rejects any structural or
// vocabulary violation naming the field. It never rejects a legitimate value
// such as an absent notice or marking.
func Validate(profile *Profile) error {
	if profile == nil {
		return nil
	}
	if !member(profile.IntendedAudience, audiences) {
		return invalid("safety_profile.intended_audience")
	}
	if !list(profile.ContentDescriptors, descriptors) {
		return invalid("safety_profile.content_descriptors")
	}
	if !list(profile.HighImpactDecisionUses, highImpact) {
		return invalid("safety_profile.high_impact_decision_uses")
	}
	ai := profile.AI
	if ai.DirectInteraction == nil {
		return invalid("safety_profile.ai.direct_interaction")
	}
	if *ai.DirectInteraction {
		if !member(ai.InteractionNotice, presence) {
			return invalid("safety_profile.ai.interaction_notice")
		}
	} else if ai.InteractionNotice != "not-applicable" {
		return invalid("safety_profile.ai.interaction_notice")
	}
	if !list(ai.RiskFeatures, riskFeatures) {
		return invalid("safety_profile.ai.risk_features")
	}
	subjectApplies := false
	for _, feature := range ai.RiskFeatures {
		if member(feature, subjectTriggers) {
			subjectApplies = true
		}
	}
	if subjectApplies {
		if !member(ai.SubjectNotice, presence) {
			return invalid("safety_profile.ai.subject_notice")
		}
	} else if ai.SubjectNotice != "not-applicable" {
		return invalid("safety_profile.ai.subject_notice")
	}
	if ai.Outputs == nil {
		return invalid("safety_profile.ai.outputs")
	}
	seen := make(map[string]struct{}, len(ai.Outputs))
	for index, output := range ai.Outputs {
		field := fmt.Sprintf("safety_profile.ai.outputs[%d]", index)
		if !member(output.Modality, modalities) {
			return invalid(field + ".modality")
		}
		if _, duplicate := seen[output.Modality]; duplicate {
			return invalid("safety_profile.ai.outputs")
		}
		seen[output.Modality] = struct{}{}
		if !member(output.Exposure, exposures) {
			return invalid(field + ".exposure")
		}
		if output.Exposure == "publishable" {
			if !member(output.PublicationControl, publicationValues) {
				return invalid(field + ".publication_control")
			}
		} else if output.PublicationControl != "not-applicable" {
			return invalid(field + ".publication_control")
		}
		if output.Exposure == "in-app-only" {
			if output.ExportVisibleMarking != "not-applicable" {
				return invalid(field + ".export_visible_marking")
			}
		} else if !member(output.ExportVisibleMarking, presence) {
			return invalid(field + ".export_visible_marking")
		}
		if !member(output.InProductNotice, presence) {
			return invalid(field + ".in_product_notice")
		}
		if !member(output.MachineReadableMarking, presence) {
			return invalid(field + ".machine_readable_marking")
		}
	}
	data := profile.DataPractices
	if data.PublisherDirectExternalNetwork == nil {
		return invalid("safety_profile.data_practices.publisher_direct_external_network")
	}
	if !list(data.Telemetry, telemetry) {
		return invalid("safety_profile.data_practices.telemetry")
	}
	if !member(data.ThirdPartyAccount, accounts) {
		return invalid("safety_profile.data_practices.third_party_account")
	}
	if !member(data.UserContentSharing, sharing) {
		return invalid("safety_profile.data_practices.user_content_sharing")
	}
	if !list(data.CommercialFeatures, commercial) {
		return invalid("safety_profile.data_practices.commercial_features")
	}
	if !list(data.SensitiveDataCategories, sensitive) {
		return invalid("safety_profile.data_practices.sensitive_data_categories")
	}
	encoded, err := json.Marshal(profile)
	if err != nil || len(encoded) > MaxBytes {
		return invalid("safety_profile")
	}
	return nil
}

// Clone returns an independent copy so projections never alias owner slices.
func Clone(profile *Profile) *Profile {
	if profile == nil {
		return nil
	}
	cloned := *profile
	cloned.AI.DirectInteraction = cloneBool(profile.AI.DirectInteraction)
	cloned.DataPractices.PublisherDirectExternalNetwork = cloneBool(profile.DataPractices.PublisherDirectExternalNetwork)
	cloned.ContentDescriptors = cloneStrings(profile.ContentDescriptors)
	cloned.HighImpactDecisionUses = cloneStrings(profile.HighImpactDecisionUses)
	cloned.AI.RiskFeatures = cloneStrings(profile.AI.RiskFeatures)
	cloned.AI.Outputs = append([]Output(nil), profile.AI.Outputs...)
	if profile.AI.Outputs != nil && cloned.AI.Outputs == nil {
		cloned.AI.Outputs = []Output{}
	}
	cloned.DataPractices.Telemetry = cloneStrings(profile.DataPractices.Telemetry)
	cloned.DataPractices.CommercialFeatures = cloneStrings(profile.DataPractices.CommercialFeatures)
	cloned.DataPractices.SensitiveDataCategories = cloneStrings(profile.DataPractices.SensitiveDataCategories)
	return &cloned
}

func cloneBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneStrings(values []string) []string {
	if values == nil {
		return nil
	}
	return append([]string{}, values...)
}

// Equal compares two declarations by value; nil and empty lists are the same
// declared fact, and both-nil is the same undeclared state.
func Equal(left, right *Profile) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.IntendedAudience == right.IntendedAudience &&
		sameStrings(left.ContentDescriptors, right.ContentDescriptors) &&
		sameStrings(left.HighImpactDecisionUses, right.HighImpactDecisionUses) &&
		sameBool(left.AI.DirectInteraction, right.AI.DirectInteraction) &&
		left.AI.InteractionNotice == right.AI.InteractionNotice &&
		sameStrings(left.AI.RiskFeatures, right.AI.RiskFeatures) &&
		left.AI.SubjectNotice == right.AI.SubjectNotice &&
		sameOutputs(left.AI.Outputs, right.AI.Outputs) &&
		sameBool(left.DataPractices.PublisherDirectExternalNetwork, right.DataPractices.PublisherDirectExternalNetwork) &&
		sameStrings(left.DataPractices.Telemetry, right.DataPractices.Telemetry) &&
		left.DataPractices.ThirdPartyAccount == right.DataPractices.ThirdPartyAccount &&
		left.DataPractices.UserContentSharing == right.DataPractices.UserContentSharing &&
		sameStrings(left.DataPractices.CommercialFeatures, right.DataPractices.CommercialFeatures) &&
		sameStrings(left.DataPractices.SensitiveDataCategories, right.DataPractices.SensitiveDataCategories)
}

func sameBool(left, right *bool) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func sameOutputs(left, right []Output) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
