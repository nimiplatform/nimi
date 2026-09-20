package app

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appsafety"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestApprovedAppCatalogProjectionCarriesDeclarationOrStaysUndeclared(t *testing.T) {
	encode := base64.RawURLEncoding.EncodeToString
	revision := strings.Repeat("a", 40)
	descriptorID := "publisher.example@1.2.3"
	selector, err := publicappregistry.ParseApprovedTargetSelector("nats_v1_" + encode([]byte(descriptorID)) + "." + encode([]byte("windows-x86_64")) + "." + encode([]byte(revision)))
	if err != nil {
		t.Fatal(err)
	}
	base := publicappregistry.ResolvedApprovedTarget{
		Selector: selector, RegistryRevision: revision, DescriptorID: descriptorID,
		AppID: "publisher.example", DisplayName: "Example App", Version: "1.2.3", Visibility: "public",
		Publisher: publicappregistry.Publisher{GitHubNamespace: "publisher"},
		Source:    publicappregistry.Source{Repository: "https://github.com/publisher/example", License: publicappregistry.SourceLicense{SPDXExpression: "MIT"}},
		AppAccess: []string{}, CapabilityContractRefs: []string{}, RequiredStandardizedFeatureRefs: []string{},
		StoragePolicy: publicappregistry.StoragePolicy{Kind: "nimi-mediated-default"},
		Target:        publicappregistry.Target{TargetID: "windows-x86_64", OS: "windows", Arch: "x86_64", NativeTrust: publicappregistry.NativeTrust{WindowsCodeSigning: "unsigned", MacOSNotarization: "not-applicable"}},
	}
	undeclared, err := approvedAppCatalogTargetProjection(base)
	if err != nil || undeclared.SafetyDeclaration != nil {
		t.Fatalf("undeclared target must project no declaration: %+v %v", undeclared.SafetyDeclaration, err)
	}
	declared := base
	declared.SafetyProfile = &appsafety.Profile{
		IntendedAudience: "teen", ContentDescriptors: []string{"violence"},
		AI:                     appsafety.AI{DirectInteraction: appsafety.Bool(true), InteractionNotice: "absent", RiskFeatures: []string{"emotion-recognition"}, SubjectNotice: "absent", Outputs: []appsafety.Output{{Modality: "image", Exposure: "publishable", PublicationControl: "automatic", InProductNotice: "present", ExportVisibleMarking: "absent", MachineReadableMarking: "absent"}}},
		DataPractices:          appsafety.DataPractices{PublisherDirectExternalNetwork: appsafety.Bool(true), Telemetry: []string{"usage-analytics"}, ThirdPartyAccount: "required", UserContentSharing: "public", CommercialFeatures: []string{"subscription"}, SensitiveDataCategories: []string{}},
		HighImpactDecisionUses: []string{},
	}
	projected, err := approvedAppCatalogTargetProjection(declared)
	if err != nil {
		t.Fatal(err)
	}
	declaration := projected.GetSafetyDeclaration()
	if declaration.GetIntendedAudience() != "teen" || declaration.GetContentDescriptors()[0] != "violence" || !declaration.GetAiDirectInteraction() ||
		declaration.GetAiInteractionNotice() != "absent" || declaration.GetAiRiskFeatures()[0] != "emotion-recognition" || declaration.GetAiSubjectNotice() != "absent" ||
		len(declaration.GetAiOutputs()) != 1 || declaration.GetAiOutputs()[0].GetModality() != "image" || declaration.GetAiOutputs()[0].GetPublicationControl() != "automatic" ||
		declaration.GetAiOutputs()[0].GetExportVisibleMarking() != "absent" || !declaration.GetPublisherDirectExternalNetwork() || declaration.GetTelemetry()[0] != "usage-analytics" ||
		declaration.GetThirdPartyAccount() != "required" || declaration.GetUserContentSharing() != "public" || declaration.GetCommercialFeatures()[0] != "subscription" ||
		len(declaration.GetSensitiveDataCategories()) != 0 || len(declaration.GetHighImpactDecisionUses()) != 0 {
		t.Fatalf("declaration projected incorrectly: %+v", declaration)
	}
	declared.SafetyProfile.ContentDescriptors[0] = "mutated"
	if declaration.GetContentDescriptors()[0] != "violence" {
		t.Fatal("projection aliases the owner declaration slices")
	}
}

func TestCatalogRowAbsenceStaysDistinctFromRegistryReadFailure(t *testing.T) {
	for name, test := range map[string]struct {
		err        error
		code       codes.Code
		reasonCode runtimev1.ReasonCode
	}{
		"catalog list row absent":     {err: approvedAppCatalogError(publicappregistry.ErrCatalogAppNotFound), code: codes.FailedPrecondition, reasonCode: runtimev1.ReasonCode_APP_CATALOG_ROW_ABSENT},
		"catalog list registry down":  {err: approvedAppCatalogError(publicappregistry.ErrRegistryUnavailable), code: codes.Unavailable, reasonCode: runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE},
		"installed launch row absent": {err: installedLaunchError(publicappregistry.ErrCatalogAppNotFound), code: codes.FailedPrecondition, reasonCode: runtimev1.ReasonCode_APP_CATALOG_ROW_ABSENT},
		"installed launch registry":   {err: installedLaunchError(publicappregistry.ErrRegistryUnavailable), code: codes.Unavailable, reasonCode: runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE},
		"installed launch snapshot":   {err: installedLaunchError(publicappregistry.ErrInvalidRegistrySnapshot), code: codes.Unavailable, reasonCode: runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE},
		"installed launch policy":     {err: installedLaunchError(&publicappregistry.PolicyBlockedError{Reason: "misstated", Revision: 3}), code: codes.FailedPrecondition, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED},
	} {
		t.Run(name, func(t *testing.T) {
			reasonCode, _ := grpcerr.ExtractReasonCode(test.err)
			if status.Code(test.err) != test.code || reasonCode != test.reasonCode {
				t.Fatalf("code=%s reason=%s err=%v", status.Code(test.err), reasonCode, test.err)
			}
		})
	}
	if !errors.Is(publicappregistry.ErrCatalogAppNotFound, publicappregistry.ErrCatalogAppNotFound) {
		t.Fatal("sentinel identity")
	}
	_ = context.Background()
}
