package main

import (
	"strings"
	"testing"
	"time"
)

func TestExecutionBindingRejectsSourceHashMismatch(t *testing.T) {
	report, initial, final, args, now := validExecutionBindingFixture()
	final.SourceSHA256 = "different-source"
	assertBindingErrorContains(t, report, initial, final, args, now, "source hash mismatch")
}

func TestExecutionBindingRejectsDirtyDescriptorMismatch(t *testing.T) {
	report, initial, final, args, now := validExecutionBindingFixture()
	final.DirtyDescriptorSHA256 = "different-dirty-state"
	assertBindingErrorContains(t, report, initial, final, args, now, "dirty descriptor mismatch")
}

func TestExecutionBindingRejectsGoToolchainMismatch(t *testing.T) {
	report, initial, final, args, now := validExecutionBindingFixture()
	final.GoVersion = "go version go0.0.0"
	assertBindingErrorContains(t, report, initial, final, args, now, "Go toolchain mismatch")
}

func TestExecutionBindingRejectsGoArgsMismatch(t *testing.T) {
	report, initial, final, args, now := validExecutionBindingFixture()
	report.GoTestArgs = []string{"test", "./..."}
	assertBindingErrorContains(t, report, initial, final, args, now, "Go args mismatch")
}

func TestExecutionBindingRejectsStaleReport(t *testing.T) {
	report, initial, final, args, now := validExecutionBindingFixture()
	report.StartedAt = now.Add(-time.Hour - time.Second).Format(time.RFC3339Nano)
	report.FinishedAt = now.Add(-time.Hour).Format(time.RFC3339Nano)
	assertBindingErrorContains(t, report, initial, final, args, now, "stale execution report")
}

func TestExecutionBindingAcceptsFreshExactReport(t *testing.T) {
	report, initial, final, args, now := validExecutionBindingFixture()
	if err := validateExecutionBinding(report, initial, final, args, now); err != nil {
		t.Fatalf("fresh exact report rejected: %v", err)
	}
}

func TestExecutionBindingAcceptsExplicitNoTestFilesPackage(t *testing.T) {
	report, initial, final, args, now := validExecutionBindingFixture()
	report.PackageTerminalStates = append(report.PackageTerminalStates,
		packageTiming{Package: "example/no-tests", TerminalAction: "skip", NoTestFiles: true})
	if err := validateExecutionBinding(report, initial, final, args, now); err != nil {
		t.Fatalf("explicit no-test-files package rejected: %v", err)
	}
}

func validExecutionBindingFixture() (executionReport, sourceBinding, sourceBinding, []string, time.Time) {
	now := time.Now().UTC()
	args := []string{"test", "-p=1", "-parallel=1", "./...", "-json", "-count=1"}
	report := executionReport{
		SchemaVersion:       executionReportSchema,
		StartedAt:           now.Add(-time.Second).Format(time.RFC3339Nano),
		FinishedAt:          now.Format(time.RFC3339Nano),
		GoTestArgs:          append([]string(nil), args...),
		ExitCode:            0,
		MalformedEventCount: 0,
		PackageTerminalStates: []packageTiming{
			{Package: "example/pkg", TerminalAction: "pass", ElapsedSeconds: 0.1},
		},
	}
	source := validSourceBinding()
	return report, source, source, args, now
}

func validSourceBinding() sourceBinding {
	return sourceBinding{
		SchemaVersion:         sourceBindingSchema,
		HEAD:                  "0123456789abcdef",
		SourceSHA256:          "source",
		DirtyDescriptorSHA256: "dirty",
		GoVersion:             "go version go1.26.4 windows/amd64",
		GOOS:                  "windows",
		GOARCH:                "amd64",
	}
}

func assertBindingErrorContains(
	t *testing.T,
	report executionReport,
	initial sourceBinding,
	final sourceBinding,
	args []string,
	now time.Time,
	want string,
) {
	t.Helper()
	err := validateExecutionBinding(report, initial, final, args, now)
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("expected %q error, got %v", want, err)
	}
}
