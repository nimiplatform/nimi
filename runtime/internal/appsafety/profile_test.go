package appsafety

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func declared() *Profile {
	return &Profile{
		IntendedAudience:   "general",
		ContentDescriptors: []string{},
		AI: AI{DirectInteraction: Bool(true), InteractionNotice: "absent", RiskFeatures: []string{}, SubjectNotice: "not-applicable", Outputs: []Output{{
			Modality: "text", Exposure: "exportable", PublicationControl: "not-applicable", InProductNotice: "absent", ExportVisibleMarking: "absent", MachineReadableMarking: "absent",
		}}},
		DataPractices:          DataPractices{PublisherDirectExternalNetwork: Bool(false), Telemetry: []string{}, ThirdPartyAccount: "none", UserContentSharing: "none", CommercialFeatures: []string{}, SensitiveDataCategories: []string{}},
		HighImpactDecisionUses: []string{},
	}
}

func TestValidateAcceptsUndeclaredAndLegitimateDeclarations(t *testing.T) {
	if err := Validate(nil); err != nil {
		t.Fatalf("undeclared must be accepted: %v", err)
	}
	if err := Validate(declared()); err != nil {
		t.Fatal(err)
	}
	nonAI := declared()
	nonAI.AI = AI{DirectInteraction: Bool(false), InteractionNotice: "not-applicable", RiskFeatures: []string{}, SubjectNotice: "not-applicable", Outputs: []Output{}}
	if err := Validate(nonAI); err != nil {
		t.Fatalf("non-AI declaration rejected: %v", err)
	}
	rich := declared()
	rich.ContentDescriptors = []string{"violence", "strong-language"}
	rich.AI.RiskFeatures = []string{"emotion-recognition"}
	rich.AI.SubjectNotice = "absent"
	rich.AI.Outputs = append(rich.AI.Outputs, Output{Modality: "image", Exposure: "publishable", PublicationControl: "user-confirmed", InProductNotice: "present", ExportVisibleMarking: "absent", MachineReadableMarking: "absent"})
	rich.HighImpactDecisionUses = []string{"medical-diagnosis-treatment"}
	if err := Validate(rich); err != nil {
		t.Fatalf("absent notices and markings are legitimate values: %v", err)
	}
}

func TestValidateRejectsVocabularyAndStructureViolationsNamingTheField(t *testing.T) {
	for name, mutate := range map[string]func(*Profile){
		"audience":                func(p *Profile) { p.IntendedAudience = "everyone" },
		"descriptor vocabulary":   func(p *Profile) { p.ContentDescriptors = []string{"scary"} },
		"descriptor duplicate":    func(p *Profile) { p.ContentDescriptors = []string{"violence", "violence"} },
		"descriptor missing list": func(p *Profile) { p.ContentDescriptors = nil },
		"interaction notice":      func(p *Profile) { p.AI.InteractionNotice = "not-applicable" },
		"interaction off":         func(p *Profile) { p.AI.DirectInteraction = Bool(false) },
		"interaction missing":     func(p *Profile) { p.AI.DirectInteraction = nil },
		"network missing":         func(p *Profile) { p.DataPractices.PublisherDirectExternalNetwork = nil },
		"subject notice":          func(p *Profile) { p.AI.SubjectNotice = "present" },
		"subject required":        func(p *Profile) { p.AI.RiskFeatures = []string{"biometric-categorization"} },
		"outputs missing":         func(p *Profile) { p.AI.Outputs = nil },
		"duplicate modality":      func(p *Profile) { p.AI.Outputs = append(p.AI.Outputs, p.AI.Outputs[0]) },
		"publishable control":     func(p *Profile) { p.AI.Outputs[0].Exposure = "publishable" },
		"control without publish": func(p *Profile) { p.AI.Outputs[0].PublicationControl = "automatic" },
		"in-app marking":          func(p *Profile) { p.AI.Outputs[0].Exposure = "in-app-only" },
		"export marking":          func(p *Profile) { p.AI.Outputs[0].ExportVisibleMarking = "not-applicable" },
		"machine marking":         func(p *Profile) { p.AI.Outputs[0].MachineReadableMarking = "not-applicable" },
		"account":                 func(p *Profile) { p.DataPractices.ThirdPartyAccount = "sometimes" },
		"sharing":                 func(p *Profile) { p.DataPractices.UserContentSharing = "" },
		"high impact":             func(p *Profile) { p.HighImpactDecisionUses = []string{"health-topic"} },
	} {
		t.Run(name, func(t *testing.T) {
			profile := declared()
			mutate(profile)
			err := Validate(profile)
			if !errors.Is(err, ErrInvalidProfile) || !strings.HasPrefix(err.Error(), "safety_profile") {
				t.Fatalf("%s accepted or unnamed: %v", name, err)
			}
		})
	}
}

func TestCloneAndEqualTreatNilAndEmptyListsAsTheSameFact(t *testing.T) {
	original := declared()
	cloned := Clone(original)
	cloned.ContentDescriptors = append(cloned.ContentDescriptors, "violence")
	cloned.AI.Outputs[0].Modality = "image"
	if len(original.ContentDescriptors) != 0 || original.AI.Outputs[0].Modality != "text" {
		t.Fatal("clone aliases owner slices")
	}
	if Clone(nil) != nil || !Equal(nil, nil) || Equal(nil, declared()) || Equal(declared(), nil) {
		t.Fatal("nil handling")
	}
	left := declared()
	right := declared()
	right.ContentDescriptors = nil
	right.AI.RiskFeatures = nil
	if !Equal(left, right) {
		t.Fatal("empty and nil lists are the same declared fact")
	}
	right.IntendedAudience = "adult"
	if Equal(left, right) {
		t.Fatal("changed value must differ")
	}
	raw, err := json.Marshal(declared())
	if err != nil || strings.Contains(string(raw), "null") {
		t.Fatalf("declared lists serialize explicitly: %s %v", raw, err)
	}
}
