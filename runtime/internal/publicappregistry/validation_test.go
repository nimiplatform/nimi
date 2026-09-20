package publicappregistry

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/appsafety"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

func testSelector(t *testing.T, descriptorID, targetID, revision string) ApprovedTargetSelector {
	t.Helper()
	encode := base64.RawURLEncoding.EncodeToString
	selector, err := ParseApprovedTargetSelector("nats_v1_" + encode([]byte(descriptorID)) + "." + encode([]byte(targetID)) + "." + encode([]byte(revision)))
	if err != nil {
		t.Fatal(err)
	}
	return selector
}

func TestDescriptorCarriesOptionalSafetyDeclarationThroughOneParser(t *testing.T) {
	undeclared := validDescriptorDocument()
	target, err := validateDescriptor(undeclared, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64")
	if err != nil {
		t.Fatal(err)
	}
	row := registryAppRow{Visibility: "public"}
	selector := testSelector(t, undeclared.DescriptorID, target.TargetID, testRevisionA)
	if resolved := resolvedApprovedTarget(selector, undeclared, target, row, testRevisionA); resolved.SafetyProfile != nil {
		t.Fatalf("historical descriptor must resolve as undeclared: %+v", resolved.SafetyProfile)
	}
	declared := validDescriptorDocument()
	declared.Candidate.SafetyProfile = &appsafety.Profile{
		IntendedAudience: "teen", ContentDescriptors: []string{"violence"},
		AI:                     appsafety.AI{DirectInteraction: appsafety.Bool(true), InteractionNotice: "present", RiskFeatures: []string{}, SubjectNotice: "not-applicable", Outputs: []appsafety.Output{{Modality: "image", Exposure: "publishable", PublicationControl: "user-confirmed", InProductNotice: "present", ExportVisibleMarking: "absent", MachineReadableMarking: "absent"}}},
		DataPractices:          appsafety.DataPractices{PublisherDirectExternalNetwork: appsafety.Bool(false), Telemetry: []string{"crash-diagnostics"}, ThirdPartyAccount: "optional", UserContentSharing: "private", CommercialFeatures: []string{}, SensitiveDataCategories: []string{}},
		HighImpactDecisionUses: []string{},
	}
	var roundTrip approvedDescriptorDocument
	if err := jsonstrict.Decode(mustJSON(t, declared), &roundTrip); err != nil {
		t.Fatalf("declared descriptor must decode with the same strict parser: %v", err)
	}
	target, err = validateDescriptor(roundTrip, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64")
	if err != nil {
		t.Fatal(err)
	}
	resolved := resolvedApprovedTarget(selector, roundTrip, target, row, testRevisionA)
	if !appsafety.Equal(resolved.SafetyProfile, declared.Candidate.SafetyProfile) {
		t.Fatalf("declaration lost or altered: %+v", resolved.SafetyProfile)
	}
	roundTrip.Candidate.SafetyProfile.ContentDescriptors[0] = "mutated"
	if resolved.SafetyProfile.ContentDescriptors[0] != "violence" {
		t.Fatal("resolved target aliases the descriptor declaration")
	}
	invalid := validDescriptorDocument()
	invalid.Candidate.SafetyProfile = &appsafety.Profile{IntendedAudience: "everyone"}
	if _, err := validateDescriptor(invalid, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("invalid declaration accepted: %v", err)
	}
	unknown := strings.Replace(string(mustJSON(t, declared)), `"intended_audience":"teen"`, `"intended_audience":"teen","certified_safe":true`, 1)
	if err := jsonstrict.Decode([]byte(unknown), &roundTrip); err == nil {
		t.Fatal("unknown declaration key must be rejected by the strict parser")
	}
}
