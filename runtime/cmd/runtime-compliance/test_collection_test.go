package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGoJSONPositiveFixtureCollectsPassingTestAndTerminalPackage(t *testing.T) {
	result := scanFixture(t, "go-test-pass.jsonl")
	key := "github.com/nimiplatform/nimi/runtime/internal/streamutil:TestStreamBackpressureCloses"
	if !result.PassedTests[key] {
		t.Fatalf("passing test missing from fixture result: %#v", result.PassedTests)
	}
	if result.MalformedEvents != 0 {
		t.Fatalf("positive fixture has malformed events: %d", result.MalformedEvents)
	}
	if len(result.Packages) != 1 || result.Packages[0].TerminalAction != "pass" {
		t.Fatalf("unexpected package terminal state: %#v", result.Packages)
	}
}

func TestMalformedGoJSONFixtureFailsClosed(t *testing.T) {
	result := scanFixture(t, "go-test-malformed.jsonl")
	if result.MalformedEvents != 1 {
		t.Fatalf("malformed fixture count=%d want 1", result.MalformedEvents)
	}
	request := fullCollectionRequest()
	overallStartedAt := time.Now().Add(-2 * time.Second)
	report := buildExecutionReport(testCollectionResult{
		PassedTests:     result.PassedTests,
		Packages:        result.Packages,
		MalformedEvents: result.MalformedEvents,
		StartedAt:       time.Now().Add(-time.Second),
		FinishedAt:      time.Now(),
		ExitCode:        0,
		DisplayArgs:     request.DisplayArgs,
	}, nil, overallStartedAt, time.Now())
	source := validSourceBinding()
	if err := validateExecutionBinding(report, source, source, request.DisplayArgs, time.Now()); err == nil || !strings.Contains(err.Error(), "malformed") {
		t.Fatalf("expected malformed-event rejection, got %v", err)
	}
}

func TestFailedTestFixtureIsNotPassing(t *testing.T) {
	result := scanFixture(t, "go-test-fail.jsonl")
	key := "github.com/nimiplatform/nimi/runtime/internal/streamutil:TestStreamBackpressureCloses"
	if result.PassedTests[key] {
		t.Fatalf("failed test appeared passing: %#v", result.PassedTests)
	}
	if len(result.Packages) != 1 || result.Packages[0].TerminalAction != "fail" {
		t.Fatalf("failed package terminal state missing: %#v", result.Packages)
	}
}

func TestExecutionReportRejectsFailedTestTerminalEvenWithPassingPackage(t *testing.T) {
	request := fullCollectionRequest()
	now := time.Now()
	report := executionReport{
		SchemaVersion:       executionReportSchema,
		StartedAt:           now.Add(-time.Second).UTC().Format(time.RFC3339Nano),
		FinishedAt:          now.UTC().Format(time.RFC3339Nano),
		GoTestArgs:          request.DisplayArgs,
		ExitCode:            0,
		MalformedEventCount: 0,
		PackageTerminalStates: []packageTiming{{
			Package:        "github.com/nimiplatform/nimi/runtime/internal/streamutil",
			TerminalAction: "pass",
		}},
		TestTerminalStates: []testTiming{{
			Package:        "github.com/nimiplatform/nimi/runtime/internal/streamutil",
			Test:           "TestStreamBackpressureCloses",
			TerminalAction: "fail",
		}},
	}
	source := validSourceBinding()
	err := validateExecutionBinding(report, source, source, request.DisplayArgs, now)
	if err == nil || !strings.Contains(err.Error(), "test ") || !strings.Contains(err.Error(), "terminal state is fail") {
		t.Fatalf("expected failed test terminal rejection, got %v", err)
	}
}

func TestExecutionReportDistinguishesFullIntegrationFromFastUnitTier(t *testing.T) {
	now := time.Now()
	fullRequest := fullCollectionRequest()
	full := buildExecutionReport(testCollectionResult{
		StartedAt:       now.Add(-time.Second),
		FinishedAt:      now,
		DisplayArgs:     fullRequest.DisplayArgs,
		PackageParallel: fullRequest.PackageParallel,
		TestParallel:    fullRequest.TestParallel,
		WindowsSigner:   fullRequest.UsesWindowsSigner,
	}, nil, now.Add(-time.Second), now)
	if !full.TestEnvironment.IntegrationTierIncluded {
		t.Fatalf("full ./... request lost integration tier: %#v", full.TestEnvironment)
	}

	fastRequest := fastCollectionRequest()
	fast := buildExecutionReport(testCollectionResult{
		StartedAt:       now.Add(-time.Second),
		FinishedAt:      now,
		DisplayArgs:     fastRequest.DisplayArgs,
		PackageParallel: fastRequest.PackageParallel,
		TestParallel:    fastRequest.TestParallel,
		WindowsSigner:   fastRequest.UsesWindowsSigner,
	}, nil, now.Add(-time.Second), now)
	if fast.TestEnvironment.IntegrationTierIncluded || fast.TestEnvironment.WindowsSigner {
		t.Fatalf("fast unit tier impersonated integration: %#v", fast.TestEnvironment)
	}
}

func TestNoTestFilesPackageHasExplicitAllowedSkipState(t *testing.T) {
	result := scanFixture(t, "go-test-no-files.jsonl")
	if len(result.Packages) != 1 {
		t.Fatalf("unexpected package count: %#v", result.Packages)
	}
	pkg := result.Packages[0]
	if pkg.TerminalAction != "skip" || !pkg.NoTestFiles {
		t.Fatalf("no-test-files package was not distinguished from a skipped test package: %#v", pkg)
	}
}

func TestMissingReferencedTestFails(t *testing.T) {
	result := scanFixture(t, "go-test-pass.jsonl")
	refs := []testRef{{Package: "github.com/nimiplatform/nimi/runtime/internal/streamutil", Name: "TestMissingAuthorityReference"}}
	missing := missingPassingRefs(refs, result.PassedTests)
	if len(missing) != 1 || !strings.Contains(missing[0], "TestMissingAuthorityReference") {
		t.Fatalf("missing referenced test did not fail: %v", missing)
	}
}

func scanFixture(t *testing.T, name string) goTestScanResult {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return scanGoTestJSON(strings.NewReader(string(raw)), time.Now().Add(-time.Second), nil)
}
