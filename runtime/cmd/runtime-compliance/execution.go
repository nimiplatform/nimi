package main

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"time"
)

const executionReportSchema = "nimi.runtime-compliance-execution/v1"

var maxExecutionReportAge = 2 * time.Minute

type executionReport struct {
	SchemaVersion         string          `json:"schema_version"`
	StartedAt             string          `json:"started_at"`
	FinishedAt            string          `json:"finished_at"`
	ElapsedSeconds        float64         `json:"elapsed_seconds"`
	FirstOutputSeconds    float64         `json:"first_output_seconds"`
	FirstGoEventSeconds   float64         `json:"first_go_event_seconds"`
	GoTestArgs            []string        `json:"go_test_args"`
	ExitCode              int             `json:"exit_code"`
	MalformedEventCount   int             `json:"malformed_event_count"`
	Retry                 retryReport     `json:"retry"`
	PackageTerminalStates []packageTiming `json:"package_terminal_states"`
	TestTerminalStates    []testTiming    `json:"test_terminal_states"`
	CommandChecks         []timingEntry   `json:"command_checks"`
	Slowest               []timingEntry   `json:"slowest"`
	SlowestPackages       []packageTiming `json:"slowest_packages"`
	SlowestTests          []testTiming    `json:"slowest_tests"`
	TestEnvironment       testEnvironment `json:"test_environment"`
}

type retryReport struct {
	Occurred        bool     `json:"occurred"`
	Reason          string   `json:"reason,omitempty"`
	Packages        []string `json:"packages,omitempty"`
	DiagnosticPass  bool     `json:"diagnostic_pass,omitempty"`
	AdmissionEffect string   `json:"admission_effect"`
}

type packageTiming struct {
	Package         string   `json:"package"`
	TerminalAction  string   `json:"terminal_action"`
	ElapsedSeconds  float64  `json:"elapsed_seconds"`
	NoTestFiles     bool     `json:"no_test_files,omitempty"`
	FailedTests     []string `json:"failed_tests,omitempty"`
	ResourceClasses []string `json:"resource_classes"`
}

type testTiming struct {
	Package         string   `json:"package"`
	Test            string   `json:"test"`
	TerminalAction  string   `json:"terminal_action"`
	ElapsedSeconds  float64  `json:"elapsed_seconds"`
	ResourceClasses []string `json:"resource_classes"`
}

type testEnvironment struct {
	PackageParallelism          int    `json:"package_parallelism"`
	TestParallelism             int    `json:"test_parallelism"`
	WindowsSigner               bool   `json:"windows_signer"`
	IntegrationTierIncluded     bool   `json:"integration_tier_included"`
	ResourceClassificationBasis string `json:"resource_classification_basis"`
}

type timingEntry struct {
	Kind           string  `json:"kind"`
	Name           string  `json:"name"`
	ElapsedSeconds float64 `json:"elapsed_seconds"`
	Status         string  `json:"status"`
}

func buildExecutionReport(
	collection testCollectionResult,
	commandTimings []commandCheckResult,
	overallStartedAt time.Time,
	overallFinishedAt time.Time,
) executionReport {
	packages := append([]packageTiming(nil), collection.Packages...)
	for index := range packages {
		packages[index].ResourceClasses = classifyRuntimeTestResources(packages[index].Package, "")
	}
	tests := append([]testTiming(nil), collection.Tests...)
	for index := range tests {
		tests[index].ResourceClasses = classifyRuntimeTestResources(tests[index].Package, tests[index].Test)
	}
	commands := make([]timingEntry, 0, len(commandTimings))
	for _, result := range commandTimings {
		status := "fail"
		if result.Passed {
			status = "pass"
		} else if result.TimedOut {
			status = "timeout"
		}
		commands = append(commands, timingEntry{
			Kind:           "command",
			Name:           result.Name,
			ElapsedSeconds: result.ElapsedSeconds,
			Status:         status,
		})
	}
	slowest := make([]timingEntry, 0, len(collection.Packages)+len(commands))
	for _, pkg := range packages {
		slowest = append(slowest, timingEntry{
			Kind:           "package",
			Name:           pkg.Package,
			ElapsedSeconds: pkg.ElapsedSeconds,
			Status:         pkg.TerminalAction,
		})
	}
	slowest = append(slowest, commands...)
	sort.Slice(slowest, func(i int, j int) bool {
		if slowest[i].ElapsedSeconds == slowest[j].ElapsedSeconds {
			return slowest[i].Name < slowest[j].Name
		}
		return slowest[i].ElapsedSeconds > slowest[j].ElapsedSeconds
	})
	if len(slowest) > 10 {
		slowest = slowest[:10]
	}
	slowestPackages := append([]packageTiming(nil), packages...)
	sort.Slice(slowestPackages, func(i int, j int) bool {
		if slowestPackages[i].ElapsedSeconds == slowestPackages[j].ElapsedSeconds {
			return slowestPackages[i].Package < slowestPackages[j].Package
		}
		return slowestPackages[i].ElapsedSeconds > slowestPackages[j].ElapsedSeconds
	})
	if len(slowestPackages) > 20 {
		slowestPackages = slowestPackages[:20]
	}
	slowestTests := append([]testTiming(nil), tests...)
	sort.Slice(slowestTests, func(i int, j int) bool {
		if slowestTests[i].ElapsedSeconds == slowestTests[j].ElapsedSeconds {
			if slowestTests[i].Package == slowestTests[j].Package {
				return slowestTests[i].Test < slowestTests[j].Test
			}
			return slowestTests[i].Package < slowestTests[j].Package
		}
		return slowestTests[i].ElapsedSeconds > slowestTests[j].ElapsedSeconds
	})
	if len(slowestTests) > 20 {
		slowestTests = slowestTests[:20]
	}
	return executionReport{
		SchemaVersion:       executionReportSchema,
		StartedAt:           overallStartedAt.UTC().Format(time.RFC3339Nano),
		FinishedAt:          overallFinishedAt.UTC().Format(time.RFC3339Nano),
		ElapsedSeconds:      overallFinishedAt.Sub(overallStartedAt).Seconds(),
		FirstGoEventSeconds: collection.StartedAt.Sub(overallStartedAt).Seconds() + collection.FirstOutput.Seconds(),
		GoTestArgs:          append([]string(nil), collection.DisplayArgs...),
		ExitCode:            collection.ExitCode,
		MalformedEventCount: collection.MalformedEvents,
		Retry: retryReport{
			Occurred:        false,
			AdmissionEffect: "none",
		},
		PackageTerminalStates: packages,
		TestTerminalStates:    tests,
		CommandChecks:         commands,
		Slowest:               slowest,
		SlowestPackages:       slowestPackages,
		SlowestTests:          slowestTests,
		TestEnvironment: testEnvironment{
			PackageParallelism:          collection.PackageParallel,
			TestParallelism:             collection.TestParallel,
			WindowsSigner:               collection.WindowsSigner,
			IntegrationTierIncluded:     slices.Contains(collection.DisplayArgs, "./...") && !slices.Contains(collection.DisplayArgs, "-run"),
			ResourceClassificationBasis: "audited package/test behavior; informational only and never parallel-admission evidence",
		},
	}
}

func validateExecutionBinding(
	report executionReport,
	initialSource sourceBinding,
	finalSource sourceBinding,
	expectedArgs []string,
	now time.Time,
) error {
	if report.SchemaVersion != executionReportSchema {
		return fmt.Errorf("execution schema mismatch: got %q want %q", report.SchemaVersion, executionReportSchema)
	}
	if initialSource.SchemaVersion != sourceBindingSchema || finalSource.SchemaVersion != sourceBindingSchema {
		return errors.New("source binding schema mismatch")
	}
	if initialSource.HEAD != finalSource.HEAD {
		return fmt.Errorf("HEAD mismatch: start=%s end=%s", initialSource.HEAD, finalSource.HEAD)
	}
	if initialSource.SourceSHA256 != finalSource.SourceSHA256 {
		return fmt.Errorf("source hash mismatch: start=%s end=%s", initialSource.SourceSHA256, finalSource.SourceSHA256)
	}
	if initialSource.DirtyDescriptorSHA256 != finalSource.DirtyDescriptorSHA256 {
		return fmt.Errorf("dirty descriptor mismatch: start=%s end=%s",
			initialSource.DirtyDescriptorSHA256, finalSource.DirtyDescriptorSHA256)
	}
	if initialSource.GoVersion != finalSource.GoVersion || initialSource.GOOS != finalSource.GOOS || initialSource.GOARCH != finalSource.GOARCH {
		return fmt.Errorf("Go toolchain mismatch: start=%s/%s/%s end=%s/%s/%s",
			initialSource.GoVersion, initialSource.GOOS, initialSource.GOARCH,
			finalSource.GoVersion, finalSource.GOOS, finalSource.GOARCH)
	}
	if !slices.Equal(report.GoTestArgs, expectedArgs) {
		return fmt.Errorf("Go args mismatch: got=%v want=%v", report.GoTestArgs, expectedArgs)
	}
	if report.MalformedEventCount != 0 {
		return fmt.Errorf("malformed Go JSON event count must be zero, got %d", report.MalformedEventCount)
	}
	if report.ExitCode != 0 {
		return fmt.Errorf("Go test exit code must be zero, got %d", report.ExitCode)
	}
	startedAt, err := time.Parse(time.RFC3339Nano, report.StartedAt)
	if err != nil {
		return fmt.Errorf("malformed execution start time: %w", err)
	}
	finishedAt, err := time.Parse(time.RFC3339Nano, report.FinishedAt)
	if err != nil {
		return fmt.Errorf("malformed execution finish time: %w", err)
	}
	if finishedAt.Before(startedAt) {
		return errors.New("execution finish time precedes start time")
	}
	if now.Sub(finishedAt) > maxExecutionReportAge {
		return fmt.Errorf("stale execution report: finished %s, now %s", finishedAt, now)
	}
	if finishedAt.After(now.Add(5 * time.Second)) {
		return fmt.Errorf("execution report finish time is in the future: %s", finishedAt)
	}
	for _, pkg := range report.PackageTerminalStates {
		if pkg.TerminalAction == "skip" && pkg.NoTestFiles {
			continue
		}
		if pkg.TerminalAction != "pass" {
			return fmt.Errorf("package %s terminal state is %s", pkg.Package, pkg.TerminalAction)
		}
	}
	for _, test := range report.TestTerminalStates {
		if test.TerminalAction != "pass" && test.TerminalAction != "skip" {
			return fmt.Errorf("test %s:%s terminal state is %s", test.Package, test.Test, test.TerminalAction)
		}
	}
	return nil
}
