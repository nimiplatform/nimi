package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type staticApprovedAppCatalogProvider struct {
	targets []publicappregistry.ResolvedApprovedTarget
	err     error
}

func (provider staticApprovedAppCatalogProvider) ListCurrentPlatformTargets(context.Context) ([]publicappregistry.ResolvedApprovedTarget, error) {
	return provider.targets, provider.err
}

func TestApprovedAppCatalogProjectionKeepsSelectorAndDisplayFactsOwnerIssued(t *testing.T) {
	encode := base64.RawURLEncoding.EncodeToString
	revision := strings.Repeat("a", 40)
	descriptorID := "publisher.example@1.2.3"
	selectorText := "nats_v1_" + encode([]byte(descriptorID)) + "." +
		encode([]byte("windows-x86_64")) + "." + encode([]byte(revision))
	selector, err := publicappregistry.ParseApprovedTargetSelector(selectorText)
	if err != nil {
		t.Fatal(err)
	}
	policyReason := "security-review-revoked"
	targets := []publicappregistry.ResolvedApprovedTarget{{
		Selector: selector, RegistryRevision: revision, DescriptorID: descriptorID,
		AppID: "publisher.example", DisplayName: "Example App", Version: "1.2.3", Visibility: "public",
		KillSwitch: publicappregistry.KillSwitch{Active: true, Reason: &policyReason, Revision: 4},
		Publisher:  publicappregistry.Publisher{GitHubNamespace: "publisher", NamespaceKind: "organization", Assurance: "pseudonymous"},
		Source: publicappregistry.Source{Repository: "https://github.com/publisher/example", License: publicappregistry.SourceLicense{
			SPDXExpression: "MIT", Files: []publicappregistry.LicenseFile{{Path: "LICENSE", SHA256: strings.Repeat("b", 64)}},
		}},
		Release:   publicappregistry.Release{Tag: "v1.2.3", CommitSHA: strings.Repeat("c", 40), ReleaseURL: "https://github.com/publisher/example/releases/tag/v1.2.3", ReleaseNotesURL: "https://github.com/publisher/example/releases/tag/v1.2.3"},
		AppAccess: []string{"runtime.consume"}, CapabilityContractRefs: []string{"text.generate"},
		StoragePolicy: publicappregistry.StoragePolicy{Kind: "nimi-mediated-default", OSStorageDisclosure: []publicappregistry.StorageDisclosure{{
			PathPattern: "%LOCALAPPDATA%/Example", Purpose: "cache", Retention: "until-uninstall", Removal: "removed-with-package",
		}}},
		UpdateChannel: "stable", Support: publicappregistry.Support{EscalationURL: "https://github.com/publisher/example/issues", RecoveryInstructions: "Reinstall."},
		Target: publicappregistry.Target{TargetID: "windows-x86_64", OS: "windows", Arch: "x86_64", AssetName: "example.nimiapp", Size: 42,
			RuntimeEntry: "payload/example.exe", ExecutionProfileRef: "windows-user-mode-as-invoker-v1",
			NativeTrust: publicappregistry.NativeTrust{WindowsCodeSigning: "unsigned", MacOSNotarization: "not-applicable"}},
	}}
	service := New(nil, WithApprovedAppCatalogProvider(staticApprovedAppCatalogProvider{targets: targets}))
	response, err := service.ListApprovedAppCatalogTargets(context.Background(), &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || len(response.GetTargets()) != 1 {
		t.Fatalf("Catalog response = %+v err=%v", response, err)
	}
	projected := response.GetTargets()[0]
	if string(projected.GetApprovedTargetSelector()) != selectorText || projected.GetObservedRegistryRevision() != revision ||
		projected.GetDescriptorId() != descriptorID || projected.GetPublisherGithubNamespace() != "publisher" ||
		projected.GetSourceLicenseSpdxExpression() != "MIT" || projected.GetWindowsCodeSigning() != "unsigned" ||
		!projected.GetPolicyBlocked() || projected.GetPolicyReason() != policyReason || projected.GetPolicyRevision() != 4 {
		t.Fatalf("Catalog target = %+v", projected)
	}
	targets[0].AppAccess[0] = "mutated"
	targets[0].StoragePolicy.OSStorageDisclosure[0].Purpose = "mutated"
	if projected.GetAppAccess()[0] != "runtime.consume" || projected.GetOsStorageDisclosures()[0].GetPurpose() != "cache" {
		t.Fatalf("Catalog projection retained mutable provider slices: %+v", projected)
	}
}

func TestAppPackageInstallStartErrorsRemainTyped(t *testing.T) {
	reason := "security-review-revoked"
	tests := []struct {
		name       string
		err        error
		code       codes.Code
		reasonCode runtimev1.ReasonCode
	}{
		{name: "invalid", err: publicappregistry.ErrInvalidSelector, code: codes.InvalidArgument, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID},
		{name: "stale", err: publicappregistry.ErrStaleSelection, code: codes.Aborted, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE},
		{name: "policy", err: &publicappregistry.PolicyBlockedError{Reason: reason, Revision: 3}, code: codes.FailedPrecondition, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED},
		{name: "installed", err: nimiappinstall.ErrAppAlreadyInstalled, code: codes.AlreadyExists, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_ALREADY_INSTALLED},
		{name: "active", err: localappkernel.ErrPackageJobActive, code: codes.Aborted, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_JOB_ACTIVE},
		{name: "unavailable", err: nimiappinstall.ErrUnsupportedInstallPlatform, code: codes.FailedPrecondition, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE},
		{name: "Registry unavailable", err: publicappregistry.ErrRegistryUnavailable, code: codes.Unavailable, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE},
		{name: "persistence unavailable", err: nimiappinstall.ErrInstallPersistenceUnavailable, code: codes.Unavailable, reasonCode: runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE},
		{name: "canceled", err: context.Canceled, code: codes.Canceled},
		{name: "deadline", err: context.DeadlineExceeded, code: codes.DeadlineExceeded},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := appPackageInstallStartError(test.err)
			reasonCode, hasReason := grpcerr.ExtractReasonCode(err)
			if status.Code(err) != test.code || test.reasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED && reasonCode != test.reasonCode ||
				test.reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED && hasReason {
				t.Fatalf("start error code=%s reason=%s err=%v", status.Code(err), reasonCode, err)
			}
		})
	}
}

func TestApprovedAppCatalogErrorsRemainTyped(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		code       codes.Code
		reasonCode runtimev1.ReasonCode
	}{
		{name: "unsupported target", err: publicappregistry.ErrCatalogTargetNotFound, code: codes.FailedPrecondition, reasonCode: runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE},
		{name: "Registry unavailable", err: publicappregistry.ErrRegistryUnavailable, code: codes.Unavailable, reasonCode: runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE},
		{name: "invalid snapshot", err: publicappregistry.ErrInvalidRegistrySnapshot, code: codes.Unavailable, reasonCode: runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE},
		{name: "canceled", err: context.Canceled, code: codes.Canceled},
		{name: "deadline", err: context.DeadlineExceeded, code: codes.DeadlineExceeded},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := approvedAppCatalogError(test.err)
			reasonCode, hasReason := grpcerr.ExtractReasonCode(err)
			if status.Code(err) != test.code || test.reasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED && reasonCode != test.reasonCode ||
				test.reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED && hasReason {
				t.Fatalf("Catalog error code=%s reason=%s err=%v", status.Code(err), reasonCode, err)
			}
		})
	}

	service := New(nil)
	_, err := service.ListApprovedAppCatalogTargets(context.Background(), &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	reasonCode, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || reasonCode != runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE {
		t.Fatalf("unwired Catalog code=%s reason=%s err=%v", status.Code(err), reasonCode, err)
	}
}

func TestRuntimeAppPackageReadAndUnwiredMutationStaySeparated(t *testing.T) {
	ctx := context.Background()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 77)
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := t.TempDir()
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{
		Random: bytes.NewReader(bytes.Repeat([]byte{0xd1}, 1024)), HostInstallID: "package-handler-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	job, err := kernel.PackageLifecycle().Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: "nimi.example", SourceClass: localappkernel.SourceClassVerified,
		Kind: localappkernel.PackageJobRepair, TargetRef: "descriptor:nimi.example:1.0.0",
		ProgressBasis: localappkernel.PackageProgressIndeterminate, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	service := New(nil, WithLocalAppKernel(kernel))

	releases, err := service.ListCommittedAppReleases(ctx, &runtimev1.ListCommittedAppReleasesRequest{})
	if err != nil || len(releases.GetReleases()) != 0 || releases.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("committed releases = %+v err=%v", releases, err)
	}
	jobs, err := service.ListAppPackageJobs(ctx, &runtimev1.ListAppPackageJobsRequest{})
	if err != nil || len(jobs.GetJobs()) != 1 || string(jobs.GetJobs()[0].GetJobId()) != job.JobID ||
		jobs.GetJobs()[0].GetSourceClass() != runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_VERIFIED {
		t.Fatalf("package jobs = %+v err=%v", jobs, err)
	}
	loaded, err := service.GetAppPackageJob(ctx, &runtimev1.GetAppPackageJobRequest{JobId: []byte(job.JobID)})
	if err != nil || loaded.GetJob().GetPhase() != runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED {
		t.Fatalf("loaded package job = %+v err=%v", loaded, err)
	}

	_, err = service.CancelAppPackageJob(ctx, &runtimev1.CancelAppPackageJobRequest{
		JobId: []byte(job.JobID), ExpectedPhase: runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING,
		ReasonCode: "user-canceled",
	})
	reason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE {
		t.Fatalf("unwired cancel = code=%s reason=%s err=%v", status.Code(err), reason, err)
	}
	loaded, err = service.GetAppPackageJob(ctx, &runtimev1.GetAppPackageJobRequest{JobId: []byte(job.JobID)})
	if err != nil || loaded.GetJob().GetPhase() != runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED {
		t.Fatalf("unwired cancel mutated job = %+v err=%v", loaded, err)
	}

	_, err = service.StartAppPackageInstall(ctx, &runtimev1.StartAppPackageInstallRequest{ApprovedTargetSelector: []byte("invalid")})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.InvalidArgument || reason != runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID {
		t.Fatalf("invalid start = code=%s reason=%s err=%v", status.Code(err), reason, err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	selector := "nats_v1_" + encode([]byte("publisher.example@1.2.3")) + "." +
		encode([]byte("windows-x86_64")) + "." + encode([]byte(strings.Repeat("a", 40)))
	_, err = service.StartAppPackageInstall(ctx, &runtimev1.StartAppPackageInstallRequest{
		ApprovedTargetSelector: []byte(selector),
	})
	reason, _ = grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE {
		t.Fatalf("unwired start = code=%s reason=%s err=%v", status.Code(err), reason, err)
	}
}
