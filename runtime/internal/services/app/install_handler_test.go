package app

import (
	"context"
	"io"
	"log/slog"
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type allowingAppSessionValidator struct{}

func (allowingAppSessionValidator) ValidateAppSession(string, string, string) (runtimev1.ReasonCode, bool) {
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, true
}

type immutablePackageUnavailableStream struct{ ctx context.Context }

func (s immutablePackageUnavailableStream) SetHeader(metadata.MD) error  { return nil }
func (s immutablePackageUnavailableStream) SendHeader(metadata.MD) error { return nil }
func (s immutablePackageUnavailableStream) SetTrailer(metadata.MD)       {}
func (s immutablePackageUnavailableStream) Context() context.Context     { return s.ctx }
func (s immutablePackageUnavailableStream) SendMsg(any) error            { return nil }
func (s immutablePackageUnavailableStream) RecvMsg(any) error            { return nil }
func (s immutablePackageUnavailableStream) Send(*runtimev1.AppInstallJobEvent) error {
	return nil
}

func TestImmutablePackageLifecycleMethodsAreUnavailableBeforeTargetParsing(t *testing.T) {
	svc := New(testLogger())
	tests := []struct {
		name string
		call func() error
	}{
		{name: "prepare intent", call: func() error { _, err := svc.PrepareAppLifecycleIntent(context.Background(), nil); return err }},
		{name: "intent status", call: func() error { _, err := svc.GetAppLifecycleIntentStatus(context.Background(), nil); return err }},
		{name: "install", call: func() error { _, err := svc.InstallApp(context.Background(), nil); return err }},
		{name: "uninstall", call: func() error { _, err := svc.UninstallApp(context.Background(), nil); return err }},
		{name: "get job", call: func() error { _, err := svc.GetAppInstallJob(context.Background(), nil); return err }},
		{name: "list jobs", call: func() error { _, err := svc.ListAppInstallJobs(context.Background(), nil); return err }},
		{name: "watch jobs", call: func() error {
			return svc.WatchAppInstallJobEvents(nil, immutablePackageUnavailableStream{ctx: context.Background()})
		}},
		{name: "update", call: func() error { _, err := svc.UpdateApp(context.Background(), nil); return err }},
		{name: "repair", call: func() error { _, err := svc.HealthRepairApp(context.Background(), nil); return err }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertImmutablePackageUnavailable(t, test.call())
		})
	}
}

func TestImmutablePackageLifecycleMethodsIgnoreCallerSelectedTargets(t *testing.T) {
	svc := New(testLogger(), WithSessionValidator(allowingAppSessionValidator{}))
	tests := []struct {
		name string
		call func() error
	}{
		{name: "install", call: func() error {
			_, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "caller-selected", Confirmed: true})
			return err
		}},
		{name: "uninstall", call: func() error {
			_, err := svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{AppId: "caller-selected", DeleteDurableData: true, DestructiveDataDeleteConfirmed: true})
			return err
		}},
		{name: "update", call: func() error {
			_, err := svc.UpdateApp(context.Background(), &runtimev1.UpdateAppRequest{AppId: "caller-selected", Confirmed: true})
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertImmutablePackageUnavailable(t, test.call())
		})
	}
}

func TestAppServiceHasNoImmutablePackageMaterializerOrJobStore(t *testing.T) {
	typeOfService := reflect.TypeOf(Service{})
	for _, retiredField := range []string{"installRuntime", "installJobs", "lifecycleIntents"} {
		if _, exists := typeOfService.FieldByName(retiredField); exists {
			t.Fatalf("0K service retained positive immutable package field %q", retiredField)
		}
	}
}

func assertImmutablePackageUnavailable(t *testing.T, err error) {
	t.Helper()
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("immutable package code = %v, want Unimplemented: %v", status.Code(err), err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("immutable package reason = %v present=%v, want LOCAL_APP_OPERATION_UNAVAILABLE: %v", reason, ok, err)
	}
}
