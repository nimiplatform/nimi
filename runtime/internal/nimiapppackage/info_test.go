package nimiapppackage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"github.com/nimiplatform/nimi/runtime/internal/appsafety"
	"image"
	"image/png"
	"strings"
	"testing"
)

func TestAppInfoRejectsIncompleteDocumentsAndInvisibleArtwork(t *testing.T) {
	for name, mutate := range map[string]func(*AppInfo){
		"name":                    func(info *AppInfo) { info.DisplayName = "" },
		"summary":                 func(info *AppInfo) { info.Summary = "" },
		"blank readme":            func(info *AppInfo) { info.ReadmeMarkdown = "  " },
		"blank notes":             func(info *AppInfo) { info.ReleaseNotesMarkdown = "\n" },
		"license":                 func(info *AppInfo) { info.License.Identifier = "" },
		"undeclared requirements": func(info *AppInfo) { info.CapabilityContractRefs = nil },
		"storage":                 func(info *AppInfo) { info.StoragePolicy.Kind = "" },
		"truncated PNG": func(info *AppInfo) {
			raw, _ := base64.StdEncoding.DecodeString(info.Icon.DataBase64)
			info.Icon.DataBase64 = base64.StdEncoding.EncodeToString(raw[:16])
		},
		"oversized notes": func(info *AppInfo) { info.ReleaseNotesMarkdown = string(bytes.Repeat([]byte("x"), 32*1024+1)) },
	} {
		t.Run(name, func(t *testing.T) {
			info := testAppInfo(t)
			mutate(&info)
			if _, err := ParseAppInfo(mustJSON(t, info)); !errors.Is(err, ErrInvalidPackage) {
				t.Fatalf("invalid %s accepted: %v", name, err)
			}
		})
	}
	for _, size := range []int{1, 128} {
		var raw bytes.Buffer
		if err := png.Encode(&raw, image.NewNRGBA(image.Rect(0, 0, size, size))); err != nil {
			t.Fatal(err)
		}
		if err := ValidateAppIcon(raw.Bytes()); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("transparent %d px placeholder accepted: %v", size, err)
		}
	}
}

func TestAppInfoIsBoundToReviewedAssetAndArchiveDeclaration(t *testing.T) {
	entries := validArchiveEntries(t)
	info := testAppInfo(t)
	digest := sha256.Sum256(entries[6].bytes)
	archive, expected := writeArchiveFixture(t, entries)
	expected.AppInfo = &AppInfoExpectation{SHA256: hex.EncodeToString(digest[:]), DisplayName: info.DisplayName, LicenseIdentifier: info.License.Identifier, CapabilityContractRefs: info.CapabilityContractRefs, RequiredStandardizedFeatureRefs: info.RequiredStandardizedFeatureRefs, StoragePolicy: info.StoragePolicy}
	if _, err := Inspect(context.Background(), archive, expected); err != nil {
		t.Fatal(err)
	}
	info.Summary = "Changed since Registry review."
	entries[6].bytes = mustJSON(t, info)
	changed, changedExpected := writeArchiveFixture(t, entries)
	changedExpected.AppInfo = expected.AppInfo
	if _, err := Inspect(context.Background(), changed, changedExpected); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("changed info asset accepted: %v", err)
	}
	info.DisplayName = "Different from declaration"
	entries[6].bytes = mustJSON(t, info)
	changed, changedExpected = writeArchiveFixture(t, entries)
	if _, err := Inspect(context.Background(), changed, changedExpected); !errors.Is(err, ErrInvalidPackage) {
		t.Fatalf("conflicting declaration accepted: %v", err)
	}
	legacy, legacyExpected := writeArchiveFixture(t, validArchiveEntries(t)[:6])
	if _, err := Inspect(context.Background(), legacy, legacyExpected); !errors.Is(err, ErrInvalidPackage) {
		t.Fatalf("package without portable info accepted: %v", err)
	}
}

func testSafetyProfile() *appsafety.Profile {
	return &appsafety.Profile{
		IntendedAudience: "general", ContentDescriptors: []string{},
		AI:                     appsafety.AI{DirectInteraction: appsafety.Bool(true), InteractionNotice: "absent", RiskFeatures: []string{}, SubjectNotice: "not-applicable", Outputs: []appsafety.Output{{Modality: "text", Exposure: "exportable", PublicationControl: "not-applicable", InProductNotice: "absent", ExportVisibleMarking: "absent", MachineReadableMarking: "absent"}}},
		DataPractices:          appsafety.DataPractices{PublisherDirectExternalNetwork: appsafety.Bool(false), Telemetry: []string{}, ThirdPartyAccount: "none", UserContentSharing: "none", CommercialFeatures: []string{}, SensitiveDataCategories: []string{}},
		HighImpactDecisionUses: []string{},
	}
}

func TestAppInfoParserReadsDeclaredAndUndeclaredDocumentsWithOneParser(t *testing.T) {
	undeclared := testAppInfo(t)
	parsed, err := ParseAppInfo(mustJSON(t, undeclared))
	if err != nil || parsed.SafetyProfile != nil {
		t.Fatalf("undeclared document must parse with nil declaration: %+v %v", parsed.SafetyProfile, err)
	}
	if strings.Contains(string(mustJSON(t, undeclared)), "safety_profile") {
		t.Fatal("undeclared information must not serialize an empty declaration")
	}
	declared := testAppInfo(t)
	declared.SafetyProfile = testSafetyProfile()
	parsed, err = ParseAppInfo(mustJSON(t, declared))
	if err != nil || !appsafety.Equal(parsed.SafetyProfile, declared.SafetyProfile) {
		t.Fatalf("declared document lost its declaration: %+v %v", parsed.SafetyProfile, err)
	}
	for name, raw := range map[string][]byte{
		"unknown nested key":  []byte(strings.Replace(string(mustJSON(t, declared)), `"intended_audience":"general"`, `"intended_audience":"general","certified_safe":true`, 1)),
		"invalid audience":    []byte(strings.Replace(string(mustJSON(t, declared)), `"intended_audience":"general"`, `"intended_audience":"everyone"`, 1)),
		"contradiction":       []byte(strings.Replace(string(mustJSON(t, declared)), `"interaction_notice":"absent"`, `"interaction_notice":"not-applicable"`, 1)),
		"missing boolean":     []byte(strings.Replace(string(mustJSON(t, declared)), `"publisher_direct_external_network":false,`, ``, 1)),
		"missing interaction": []byte(strings.Replace(string(mustJSON(t, declared)), `"direct_interaction":true,`, ``, 1)),
		"boolean as string":   []byte(strings.Replace(string(mustJSON(t, declared)), `"direct_interaction":true`, `"direct_interaction":"true"`, 1)),
	} {
		if _, err := ParseAppInfo(raw); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("%s accepted: %v", name, err)
		}
	}
}

func TestDeclaredInformationMustMatchReviewedTargetAndPackagedDeclaration(t *testing.T) {
	info := testAppInfo(t)
	info.SafetyProfile = testSafetyProfile()
	raw := mustJSON(t, info)
	digest := sha256.Sum256(raw)
	expected := Expected{AppID: info.AppID, Version: info.Version, TargetID: info.TargetID, AppAccess: info.AppAccess, AppInfo: &AppInfoExpectation{
		SHA256: hex.EncodeToString(digest[:]), DisplayName: info.DisplayName, LicenseIdentifier: info.License.Identifier, CapabilityContractRefs: info.CapabilityContractRefs,
		RequiredStandardizedFeatureRefs: info.RequiredStandardizedFeatureRefs, StoragePolicy: info.StoragePolicy, SafetyProfile: testSafetyProfile(),
	}}
	if err := ValidateAppInfoSelection(info, raw, expected); err != nil {
		t.Fatal(err)
	}
	expected.AppInfo.SafetyProfile = nil
	if err := ValidateAppInfoSelection(info, raw, expected); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("declared information must not pass an undeclared reviewed target: %v", err)
	}
	expected.AppInfo.SafetyProfile = testSafetyProfile()
	expected.AppInfo.SafetyProfile.IntendedAudience = "adult"
	if err := ValidateAppInfoSelection(info, raw, expected); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("changed declaration must not pass: %v", err)
	}
	declaration := "display_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy:\n  kind: nimi-mediated-default\n"
	profileYAML := "safety_profile:\n  intended_audience: general\n  content_descriptors: []\n  ai:\n    direct_interaction: true\n    interaction_notice: absent\n    risk_features: []\n    subject_notice: not-applicable\n    outputs:\n      - modality: text\n        exposure: exportable\n        publication_control: not-applicable\n        in_product_notice: absent\n        export_visible_marking: absent\n        machine_readable_marking: absent\n  data_practices:\n    publisher_direct_external_network: false\n    telemetry: []\n    third_party_account: none\n    user_content_sharing: none\n    commercial_features: []\n    sensitive_data_categories: []\n  high_impact_decision_uses: []\n"
	if err := validateAppInfoDeclaration(info, []byte(declaration+profileYAML), []byte(info.License.Text)); err != nil {
		t.Fatalf("matching packaged declaration rejected: %v", err)
	}
	if err := validateAppInfoDeclaration(info, []byte(declaration), []byte(info.License.Text)); !errors.Is(err, ErrInvalidPackage) {
		t.Fatalf("packaged declaration without the profile must not match declared information: %v", err)
	}
	undeclared := testAppInfo(t)
	if err := validateAppInfoDeclaration(undeclared, []byte(declaration), []byte(undeclared.License.Text)); err != nil {
		t.Fatalf("undeclared information and declaration still match: %v", err)
	}
}
