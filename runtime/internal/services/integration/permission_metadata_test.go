package integration

import (
	"context"
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type integrationDescriptionRegistrations struct {
	eligible         []Consumer
	descriptions     map[string]Consumer
	requested        []string
	descriptionError error
}

func (r *integrationDescriptionRegistrations) Consumers(context.Context) ([]Consumer, error) {
	return r.eligible, nil
}
func (r *integrationDescriptionRegistrations) DescribeConsumer(_ context.Context, subject string) (Consumer, bool, error) {
	r.requested = append(r.requested, subject)
	value, found := r.descriptions[subject]
	return value, found, r.descriptionError
}

func TestIntegrationPermissionMetadataSurvivesEligibilityLossWithoutGrantingAccess(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, dev, installed := testDecision("provider", 1), testDecision("dev", 2), testDecision("installed", 3)
	target := registerTestProvider(t, s, provider, "read")
	development := Consumer{Subject: dev.RegisteredAppSubject, AppID: "example.same", DisplayName: "Same App", SourceKind: "development"}
	packaged := Consumer{Subject: installed.RegisteredAppSubject, AppID: "example.same", DisplayName: "Same App", SourceKind: "installed"}
	registrations := &integrationDescriptionRegistrations{
		eligible:     []Consumer{development, packaged},
		descriptions: map[string]Consumer{development.Subject: development, packaged.Subject: packaged},
	}
	s.registrations = registrations
	manage := desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet)
	for _, consumer := range []Consumer{development, packaged} {
		result, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{
			ConsumerRef: ref("icons_", dev.AccountID, consumer.Subject), TargetRef: target, Operations: []string{"document.read"},
		})
		if err != nil || result.GetPermission().GetConsumer().GetSourceKind() != consumer.SourceKind {
			t.Fatalf("eligible source description missing: %v %v", result, err)
		}
	}
	registrations.eligible = []Consumer{packaged}
	development.DisplayName = "Renamed Development App"
	registrations.descriptions[development.Subject] = development
	unknown := testDecision("missing-canonical-record", 4)
	grantTestTarget(t, s, unknown, target, "document.read")
	foreign := testDecision("foreign-only-subject", 5)
	foreign.AccountID = "foreign-account"
	grantTestTarget(t, s, foreign, target, "document.read")

	result, err := s.GetIntegrationManagement(desktopIntegrationContext(t, localappop.OperationIntegrationManagementGet), &runtimev1.GetIntegrationManagementRequest{})
	if err != nil || len(result.GetConsumers()) != 1 || len(result.GetPermissions()) != 3 {
		t.Fatalf("eligibility or persisted permission list changed: %v %v", result, err)
	}
	if consumer := result.Consumers[0]; consumer.SourceKind != "installed" || consumer.ConsumerRef != ref("icons_", dev.AccountID, installed.RegisteredAppSubject) {
		t.Fatalf("display metadata promoted ineligible development App: %v", consumer)
	}
	permissions := make(map[string]*runtimev1.IntegrationPermission)
	for _, permission := range result.Permissions {
		permissions[permission.ConsumerRef] = permission
	}
	devRef := ref("icons_", dev.AccountID, dev.RegisteredAppSubject)
	metadata := permissions[devRef].GetConsumer()
	if metadata.GetConsumerRef() != devRef || metadata.GetAppId() != "example.same" || metadata.GetDisplayName() != "Renamed Development App" || metadata.GetSourceKind() != "development" {
		t.Fatalf("saved permission lost current canonical display facts: %v", metadata)
	}
	if permissions[ref("icons_", unknown.AccountID, unknown.RegisteredAppSubject)].GetConsumer() != nil {
		t.Fatal("missing canonical record acquired invented metadata")
	}
	for _, subject := range registrations.requested {
		if subject == foreign.RegisteredAppSubject {
			t.Fatal("management described a foreign account's permission subject")
		}
	}
	if _, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: devRef, TargetRef: target, Operations: []string{"document.read"}}); status.Code(err) != codes.NotFound {
		t.Fatalf("display-only metadata restored grant eligibility: %v", err)
	}
	registrations.descriptionError = errors.New("canonical description unavailable")
	lookups := len(registrations.requested)
	if _, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: devRef, TargetRef: target}); err != nil {
		t.Fatalf("optional metadata failure blocked revocation: %v", err)
	}
	if len(registrations.requested) != lookups || s.permitted(context.Background(), dev.AccountID, dev.RegisteredAppSubject, target, "document.read") {
		t.Fatal("revocation consulted display metadata or retained access")
	}
	if !s.permitted(context.Background(), installed.AccountID, installed.RegisteredAppSubject, target, "document.read") || !s.permitted(context.Background(), foreign.AccountID, foreign.RegisteredAppSubject, target, "document.read") {
		t.Fatal("metadata/revocation affected another subject or account")
	}
}

func TestIntegrationPermissionDescriptionFailureOrSubjectMismatchLeavesMetadataAbsent(t *testing.T) {
	for _, mismatch := range []bool{false, true} {
		t.Run(map[bool]string{false: "unread", true: "wrong-subject"}[mismatch], func(t *testing.T) {
			s := newIntegrationTestService(t, nil)
			consumer := testDecision("saved-subject", 1)
			grantTestTarget(t, s, consumer, "unavailable-target", "document.read")
			registrations := &integrationDescriptionRegistrations{descriptions: map[string]Consumer{
				consumer.RegisteredAppSubject: {Subject: consumer.RegisteredAppSubject, AppID: "example.app", DisplayName: "Example", SourceKind: "installed"},
			}}
			if mismatch {
				wrong := registrations.descriptions[consumer.RegisteredAppSubject]
				wrong.Subject = "different-subject"
				registrations.descriptions[consumer.RegisteredAppSubject] = wrong
			} else {
				registrations.descriptionError = errors.New("owner unread")
			}
			s.registrations = registrations
			result, err := s.GetIntegrationManagement(desktopIntegrationContext(t, localappop.OperationIntegrationManagementGet), &runtimev1.GetIntegrationManagementRequest{})
			if err != nil || len(result.GetPermissions()) != 1 || result.Permissions[0].GetConsumer() != nil {
				t.Fatalf("display failure hid the revocable row or fabricated a consumer: %v %v", result, err)
			}
		})
	}
}
