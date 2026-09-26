package grpcserver

import (
	"context"
	"errors"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func TestIntegrationRegistrationDescriptionsDoNotRequireEligibilityOrHostBinding(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	path, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	open := func(host string) *localappkernel.Kernel {
		t.Helper()
		kernel, err := localappkernel.OpenSQLite(ctx, path, identity, localappkernel.Options{HostInstallID: host, DataRoot: root})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = kernel.Close() })
		return kernel
	}
	kernel := open("host-one")
	developmentInput := localappkernel.RegisterDevelopmentInput{
		AppID: "example.same", DisplayName: "Same App", SourceRef: "project:development",
		ProjectRoot: "/project/example", ManifestPath: "/project/example/nimi.app.yaml", ShellKind: 1,
		RawDeclaration: []string{"integration.consume"}, HostExecutableDigest: "host:development",
	}
	development, err := kernel.Registrations().RegisterDevelopment(ctx, developmentInput)
	if err != nil {
		t.Fatal(err)
	}
	installed, err := kernel.Registrations().RegisterInstalled(ctx, localappkernel.RegisterInstalledInput{
		AppID: "example.same", DisplayName: "Same App", SourceRef: "package:installed", SourceClass: localappkernel.SourceClassUserImported,
		ProjectRoot: "/installed/example", ManifestPath: "/installed/example/nimi.app.yaml", RawDeclaration: []string{"integration.consume"},
		ImmutableLineageID: "lineage:installed", ProvenanceRevision: 1, ExecutionProfileRef: "execution:installed",
		HostExecutableDigest: "host:installed", PayloadRootDigest: "payload:installed",
	})
	if err != nil {
		t.Fatal(err)
	}
	platform, err := kernel.Registrations().RegisterPlatformSourceDevelopment(ctx, localappkernel.RegisterPlatformSourceInput{
		BindingSlot: "platform:desktop", AppID: "nimi.desktop", DisplayName: "Home", ProjectRoot: "/source/desktop",
		ManifestPath: "/source/desktop/nimi.app.yaml", HostExecutableDigest: "host:desktop", RawDeclaration: []string{"integration.consume"},
	})
	if err != nil {
		t.Fatal(err)
	}
	nonConsumerInput := developmentInput
	nonConsumerInput.RawDeclaration = []string{"agent.work"}
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, nonConsumerInput); err != nil {
		t.Fatal(err)
	}
	registry := integrationRegistrations{store: kernel.Registrations()}
	consumers, err := registry.Consumers(ctx)
	if err != nil || len(consumers) != 3 {
		t.Fatalf("eligible consumers: %v %v", consumers, err)
	}
	kinds := make(map[string]string)
	for _, consumer := range consumers {
		kinds[consumer.Subject] = consumer.SourceKind
	}
	if kinds[development.RegisteredAppSubject] != "development" || kinds[installed.RegisteredAppSubject] != "installed" || kinds[platform.RegisteredAppSubject] != "platform" {
		t.Fatalf("canonical source kinds were not distinguished: %v", kinds)
	}
	developmentInput.ExistingRegistrationHandle = development.RegistrationHandle
	developmentInput.DisplayName = "Renamed Development App"
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, developmentInput); err != nil {
		t.Fatal(err)
	}
	if err := kernel.Registrations().Tombstone(ctx, development.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	consumers, err = registry.Consumers(ctx)
	if err != nil || len(consumers) != 2 {
		t.Fatalf("tombstone remained eligible: %v %v", consumers, err)
	}
	description, found, err := registry.DescribeConsumer(ctx, development.RegisteredAppSubject)
	if err != nil || !found || description.DisplayName != "Renamed Development App" || description.SourceKind != "development" {
		t.Fatalf("tombstone lost canonical display facts: %v %v %v", description, found, err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	otherHost := open("host-two")
	registry = integrationRegistrations{store: otherHost.Registrations()}
	consumers, err = registry.Consumers(ctx)
	if err != nil || len(consumers) != 0 {
		t.Fatalf("missing binding became eligible: %v %v", consumers, err)
	}
	for subject, kind := range kinds {
		description, found, err := registry.DescribeConsumer(ctx, subject)
		if err != nil || !found || description.SourceKind != kind {
			t.Fatalf("missing host binding hid display facts: %v %v %v", description, found, err)
		}
		if _, err := otherHost.Registrations().GetBySubject(ctx, subject); !errors.Is(err, localappkernel.ErrRegistrationUnavailable) {
			t.Fatalf("display lookup restored an authorizing binding: %v", err)
		}
	}
	if _, found, err := registry.DescribeConsumer(ctx, "missing-canonical-subject"); err != nil || found {
		t.Fatalf("unknown subject produced display metadata: found=%v err=%v", found, err)
	}
}
