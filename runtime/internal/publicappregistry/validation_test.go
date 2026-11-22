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

func TestIndexOriginUpstreamAndStorefrontMediaValidation(t *testing.T) {
	baseRow := func(origin string, upstream *ProductUpstream) registryIndexDocument {
		return registryIndexDocument{
			SchemaVersion: 1,
			Apps: map[string]registryAppRow{
				"publisher.example-app": {
					DisplayName:     "Example App",
					Visibility:      "public",
					AdmissionStatus: "approved",
					Origin:          origin,
					Upstream:        upstream,
					LatestAdmittedReleaseByTarget: map[string]descriptorPointer{
						"windows-x86_64": {
							DescriptorID: "publisher.example-app@1.2.3",
							Path:         "descriptors/publisher.example-app/1.2.3.json",
						},
					},
				},
			},
		}
	}

	if err := validateIndex(baseRow("", nil)); err != nil {
		t.Fatalf("legacy index row without origin must remain valid during bootstrap: %v", err)
	}
	if err := validateIndex(baseRow("nimi-official", nil)); err != nil {
		t.Fatalf("nimi-official row rejected: %v", err)
	}
	if err := validateIndex(baseRow("open-source-adapted", &ProductUpstream{Name: "Upstream", URL: "https://github.com/org/repo"})); err != nil {
		t.Fatalf("open-source-adapted row with upstream rejected: %v", err)
	}
	if err := validateIndex(baseRow("open-source-adapted", nil)); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("open-source-adapted without upstream accepted: %v", err)
	}
	if err := validateIndex(baseRow("nimi-official", &ProductUpstream{Name: "Upstream", URL: "https://github.com/org/repo"})); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("nimi-official with upstream accepted: %v", err)
	}
	if err := validateIndex(baseRow("invalid-origin", nil)); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("invalid origin accepted: %v", err)
	}

	doc := validDescriptorDocument()
	doc.Candidate.StorefrontMedia = &aggregateAsset{
		AssetID:   9999,
		AssetName: "publisher.example-app-1.2.3-storefront-media.zip",
		AssetURL:  "https://github.com/publisher/example-app/releases/download/v1.2.3/publisher.example-app-1.2.3-storefront-media.zip",
		Size:      1024 * 1024,
		SHA256:    strings.Repeat("d", 64),
	}
	target, err := validateDescriptor(doc, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64")
	if err != nil {
		t.Fatalf("valid storefront_media rejected: %v", err)
	}
	row := registryAppRow{
		Visibility: "public",
		Origin:     "open-source-adapted",
		Upstream:   &ProductUpstream{Name: "Upstream", URL: "https://github.com/org/repo"},
	}
	resolved := resolvedApprovedTarget(testSelector(t, doc.DescriptorID, target.TargetID, testRevisionA), doc, target, row, testRevisionA)
	if resolved.Origin != "open-source-adapted" || resolved.Upstream == nil || resolved.Upstream.Name != "Upstream" {
		t.Fatalf("resolved target lost origin/upstream: %+v", resolved)
	}

	doc.Candidate.StorefrontMedia.Size = 8*1024*1024 + 1
	if _, err := validateDescriptor(doc, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("oversized storefront_media accepted: %v", err)
	}
	doc.Candidate.StorefrontMedia.Size = 1024
	doc.Candidate.StorefrontMedia.AssetName = "wrong-name.zip"
	if _, err := validateDescriptor(doc, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("wrong storefront_media asset name accepted: %v", err)
	}
}

func TestDescriptorArchiveSizeBudgetsEnforced(t *testing.T) {
	nativeOver := validDescriptorDocument()
	nativeOver.Candidate.Targets[0].Size = maxNativeArchiveBytes + 1
	if _, err := validateDescriptor(nativeOver, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("native archive over 2000 MiB accepted: %v", err)
	}
	nativeExact := validDescriptorDocument()
	nativeExact.Candidate.Targets[0].Size = maxNativeArchiveBytes
	if _, err := validateDescriptor(nativeExact, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "windows-x86_64"); err != nil {
		t.Fatalf("native archive at exact 2000 MiB rejected: %v", err)
	}
	managedOver := validDescriptorDocument()
	managedOver.Candidate.Targets[0].TargetID = "desktop-universal"
	managedOver.Candidate.Targets[0].OS = "any"
	managedOver.Candidate.Targets[0].Arch = "any"
	managedOver.Candidate.Targets[0].AssetName = "publisher.example-app-1.2.3-desktop-universal.nimiapp"
	managedOver.Candidate.Targets[0].AssetURL = "https://github.com/publisher/example-app/releases/download/v1.2.3/publisher.example-app-1.2.3-desktop-universal.nimiapp"
	managedOver.Candidate.Targets[0].RuntimeEntry = "payload/index.html"
	managedOver.Candidate.Targets[0].ExecutionProfileRef = "nimi-managed-web-v1"
	managedOver.Candidate.Targets[0].NativeTrust = NativeTrust{WindowsCodeSigning: "not-applicable", MacOSNotarization: "not-applicable"}
	managedOver.Candidate.Targets[0].Size = maxManagedWebArchiveBytes + 1
	if _, err := validateDescriptor(managedOver, "descriptors/publisher.example-app/1.2.3.json", "publisher.example-app", "desktop-universal"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("managed-web archive over 72 MiB accepted: %v", err)
	}
}
