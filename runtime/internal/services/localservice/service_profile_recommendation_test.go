package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/platformcatalog"
)

func TestFactoryProfileRecommendationFilterAndNoFilterOrdering(t *testing.T) {
	rows := []platformcatalog.FactoryAIProfileRow{
		{Alias: "z-canonical-first", CapabilitySet: []string{"text.generate", "image.generate"}, HostCapabilityProfileRefs: []string{"darwin-arm64-metal"}},
		{Alias: "z-canonical-second", CapabilitySet: []string{"text.generate"}, HostCapabilityProfileRefs: []string{"windows-amd64-cpu"}},
		{Alias: "a-canonical-third", CapabilitySet: []string{"text.generate"}, HostCapabilityProfileRefs: []string{"windows-amd64-cpu"}},
		{Alias: "other-capability", CapabilitySet: []string{"audio.synthesize"}, HostCapabilityProfileRefs: []string{"windows-amd64-cpu"}},
	}
	host := &runtimev1.LocalDeviceProfile{Os: "windows", Arch: "amd64"}

	unfiltered, err := projectFactoryProfileRecommendations(rows, "", host)
	if err != nil {
		t.Fatal(err)
	}
	if len(unfiltered) != 4 ||
		unfiltered[0].GetProfileAlias() != "z-canonical-first" ||
		unfiltered[1].GetProfileAlias() != "z-canonical-second" ||
		unfiltered[2].GetProfileAlias() != "a-canonical-third" ||
		unfiltered[3].GetProfileAlias() != "other-capability" {
		t.Fatalf("unfiltered order=%v", profileRecommendationAliases(unfiltered))
	}
	if len(unfiltered[0].GetCapabilities()) != 2 {
		t.Fatalf("mixed capability outcomes were reduced: %+v", unfiltered[0])
	}

	filtered, err := projectFactoryProfileRecommendations(rows, "text.generate", host)
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered) != 3 ||
		filtered[0].GetProfileAlias() != "z-canonical-second" ||
		filtered[1].GetProfileAlias() != "a-canonical-third" ||
		filtered[2].GetProfileAlias() != "z-canonical-first" {
		t.Fatalf("filtered order=%v", profileRecommendationAliases(filtered))
	}
	for _, profile := range filtered {
		if len(profile.GetCapabilities()) != 1 || profile.GetCapabilities()[0].GetCapabilityContract() != "text.generate" {
			t.Fatalf("filtered recommendation leaked another capability outcome: %+v", profile)
		}
	}
	if filtered[0].GetCapabilities()[0].GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED ||
		filtered[1].GetCapabilities()[0].GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED ||
		filtered[2].GetCapabilities()[0].GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED {
		t.Fatalf("filtered applicability=%+v", filtered)
	}
}

func TestFactoryProfileRecommendationRejectsUnknownFilter(t *testing.T) {
	_, err := projectFactoryProfileRecommendations(
		platformcatalog.FactoryAIProfileRows,
		"unknown.capability",
		&runtimev1.LocalDeviceProfile{Os: "darwin", Arch: "arm64"},
	)
	if err == nil {
		t.Fatal("unknown CapabilityContract filter was accepted")
	}
}

func profileRecommendationAliases(values []*runtimev1.FactoryProfileRecommendation) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value.GetProfileAlias())
	}
	return result
}
