package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	fullReportSchema       = "nimi.runtime-compliance-report/v2"
	diagnosticReportSchema = "nimi.runtime-compliance-diagnostic/v1"
	defaultFullTimeout     = 20 * time.Minute
	defaultDiagnosticLimit = 10 * time.Minute
)

type testRef struct {
	Package string
	Name    string
}

func (r testRef) String() string {
	return r.Package + ":" + r.Name
}

type commandCheckSpec struct {
	Name      string
	Dir       string
	Binary    string
	Args      []string
	AllowFail bool
}

type checklistItemSpec struct {
	ID          string
	Requirement string
	Tests       []testRef
	Commands    []commandCheckSpec
}

type commandCheckResult struct {
	Name           string  `json:"name"`
	Command        string  `json:"command"`
	Dir            string  `json:"dir"`
	Passed         bool    `json:"passed"`
	TimedOut       bool    `json:"timed_out,omitempty"`
	ElapsedSeconds float64 `json:"elapsed_seconds"`
	Detail         string  `json:"detail,omitempty"`
}

type checklistItemResult struct {
	ID          string               `json:"id"`
	Requirement string               `json:"requirement"`
	Status      string               `json:"status"`
	Tests       []string             `json:"tests,omitempty"`
	FailedTests []string             `json:"failed_tests,omitempty"`
	Commands    []commandCheckResult `json:"commands,omitempty"`
}

type complianceReport struct {
	SchemaVersion     string                `json:"schema_version"`
	GeneratedAt       string                `json:"generated_at"`
	Profile           string                `json:"profile"`
	AdmissionEligible bool                  `json:"admission_eligible"`
	SourceBinding     sourceBinding         `json:"source_binding"`
	Execution         executionReport       `json:"execution"`
	Summary           complianceSummary     `json:"summary"`
	Items             []checklistItemResult `json:"items"`
}

type complianceSummary struct {
	Total  int `json:"total"`
	Passed int `json:"passed"`
	Failed int `json:"failed"`
}

type diagnosticReport struct {
	SchemaVersion     string               `json:"schema_version"`
	GeneratedAt       string               `json:"generated_at"`
	Profile           string               `json:"profile"`
	AdmissionEligible bool                 `json:"admission_eligible"`
	Notice            string               `json:"notice"`
	SourceBinding     sourceBinding        `json:"source_binding"`
	Execution         executionReport      `json:"execution"`
	Summary           diagnosticSummary    `json:"summary"`
	Commands          []commandCheckResult `json:"commands,omitempty"`
}

type diagnosticSummary struct {
	SelectedTestRefs      int `json:"selected_test_refs"`
	PassedTestRefs        int `json:"passed_test_refs"`
	FailedTestRefs        int `json:"failed_test_refs"`
	ExecutedTestTerminals int `json:"executed_test_terminals"`
	PassedTestTerminals   int `json:"passed_test_terminals"`
	FailedTestTerminals   int `json:"failed_test_terminals"`
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	opts, usage, err := parseCLIOptions(args)
	if err != nil {
		fmt.Fprintf(stderr, "runtime-compliance: %v\n\n%s", err, usage)
		return 2
	}
	if opts.Help {
		fmt.Fprint(stdout, usage)
		return 0
	}

	progress := newProgressReporter(stderr, time.Now())
	progress.Phase("source_binding")
	initialSource, err := captureSourceBinding()
	if err != nil {
		progress.Fail("source_binding", err)
		return 1
	}

	ctx, cancel := context.WithTimeout(context.Background(), opts.Timeout)
	defer cancel()

	if opts.Profile == profileFull {
		return runFullCompliance(ctx, opts, initialSource, progress, stdout, stderr)
	}
	return runDiagnostic(ctx, opts, initialSource, progress, stdout, stderr)
}

func runFullCompliance(
	ctx context.Context,
	opts cliOptions,
	initialSource sourceBinding,
	progress *progressReporter,
	stdout io.Writer,
	stderr io.Writer,
) int {
	checklist := runtimeChecklist()
	request := fullCollectionRequest()
	collection, err := collectPassingTests(ctx, request, progress)
	if err != nil {
		progress.Fail("fresh_full_test_collection", err)
		return 1
	}

	progress.Phase("command_checks")
	commandResults, commandTimings := runChecklistCommands(ctx, checklist, progress)
	results := make([]checklistItemResult, 0, len(checklist))
	passCount := 0
	for _, item := range checklist {
		result := evaluateItem(item, collection.PassedTests, commandResults)
		if result.Status == "pass" {
			passCount++
		}
		results = append(results, result)
	}

	progress.Phase("source_revalidation")
	finalSource, err := captureSourceBinding()
	if err != nil {
		progress.Fail("source_revalidation", err)
		return 1
	}
	execution := buildExecutionReport(collection, commandTimings, progress.startedAt, time.Now())
	execution.FirstOutputSeconds = progress.FirstOutputElapsed().Seconds()
	if err := validateExecutionBinding(execution, initialSource, finalSource, request.DisplayArgs, time.Now()); err != nil {
		progress.Fail("source_revalidation", err)
		return 1
	}

	report := complianceReport{
		SchemaVersion:     fullReportSchema,
		GeneratedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Profile:           profileFull,
		AdmissionEligible: passCount == len(results),
		SourceBinding:     initialSource,
		Execution:         execution,
		Summary: complianceSummary{
			Total:  len(results),
			Passed: passCount,
			Failed: len(results) - passCount,
		},
		Items: results,
	}

	if err := emitJSONReport(stdout, opts.OutputPath, report); err != nil {
		fmt.Fprintf(stderr, "runtime-compliance: emit report: %v\n", err)
		return 1
	}
	progress.Slowest(execution.Slowest)
	progress.Complete(fmt.Sprintf("profile=full items=%d passed=%d failed=%d admission_eligible=%t",
		report.Summary.Total, report.Summary.Passed, report.Summary.Failed, report.AdmissionEligible))

	if opts.Gate && !report.AdmissionEligible {
		fmt.Fprintf(stderr, "gate failed: %d checklist item(s) did not pass\n", report.Summary.Failed)
		return 1
	}
	return 0
}

func runDiagnostic(
	ctx context.Context,
	opts cliOptions,
	initialSource sourceBinding,
	progress *progressReporter,
	stdout io.Writer,
	stderr io.Writer,
) int {
	refs := []testRef{}
	request := testCollectionRequest{}
	if opts.Profile == profileFast {
		request = fastCollectionRequest()
	} else if len(opts.Packages) > 0 && len(opts.Tests) == 0 {
		refs = referencedTestsForPackages(runtimeChecklist(), opts.Packages)
		var err error
		request, err = diagnosticPackageCollectionRequest(opts.Packages)
		if err != nil {
			fmt.Fprintf(stderr, "runtime-compliance: %v\n", err)
			return 2
		}
	} else {
		var err error
		refs, err = selectDiagnosticRefs(runtimeChecklist(), opts.Packages, opts.Tests)
		if err != nil {
			fmt.Fprintf(stderr, "runtime-compliance: %v\n", err)
			return 2
		}
		request = diagnosticCollectionRequest(refs)
	}

	commands := []commandCheckResult{}
	if opts.Profile == profileOwnerBatch {
		progress.Phase("owner_batch_build_vet")
		commands = runOwnerBatchCommands(ctx, progress)
		for _, result := range commands {
			if !result.Passed {
				fmt.Fprintf(stderr, "runtime-compliance: owner-batch command failed: %s\n", result.Name)
				return 1
			}
		}
	}

	collection, collectionErr := collectPassingTests(ctx, request, progress)
	retry := retryReport{Occurred: false, AdmissionEffect: "none"}
	if collectionErr != nil && opts.DiagnosticRetryFailure && len(collection.FailedPackages()) > 0 {
		failedPackages := collection.FailedPackages()
		progress.Retry("initial_go_test_nonzero", failedPackages)
		retryRequest := newTestCollectionRequestWithMode(
			failedPackages,
			request.RunPattern,
			request.PackageParallel,
			request.TestParallel,
			request.UsesWindowsSigner,
		)
		_, retryErr := collectPassingTests(ctx, retryRequest, progress)
		retry = retryReport{
			Occurred:        true,
			Reason:          "initial_go_test_nonzero",
			Packages:        failedPackages,
			DiagnosticPass:  retryErr == nil,
			AdmissionEffect: "none",
		}
	}
	if collectionErr != nil {
		progress.Fail("diagnostic_test_collection", collectionErr)
		return 1
	}

	failedRefs := missingPassingRefs(refs, collection.PassedTests)
	passedTerminals := 0
	failedTerminals := 0
	for _, terminal := range collection.Tests {
		switch terminal.TerminalAction {
		case "pass":
			passedTerminals++
		case "fail":
			failedTerminals++
		}
	}
	progress.Phase("source_revalidation")
	finalSource, err := captureSourceBinding()
	if err != nil {
		progress.Fail("source_revalidation", err)
		return 1
	}
	execution := buildExecutionReport(collection, commands, progress.startedAt, time.Now())
	execution.FirstOutputSeconds = progress.FirstOutputElapsed().Seconds()
	execution.Retry = retry
	if err := validateExecutionBinding(execution, initialSource, finalSource, request.DisplayArgs, time.Now()); err != nil {
		progress.Fail("source_revalidation", err)
		return 1
	}

	report := diagnosticReport{
		SchemaVersion:     diagnosticReportSchema,
		GeneratedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Profile:           opts.Profile,
		AdmissionEligible: false,
		Notice:            "diagnostic only; cannot satisfy candidate, release, checkpoint-close, or final Runtime admission",
		SourceBinding:     initialSource,
		Execution:         execution,
		Summary: diagnosticSummary{
			SelectedTestRefs:      len(refs),
			PassedTestRefs:        len(refs) - len(failedRefs),
			FailedTestRefs:        len(failedRefs),
			ExecutedTestTerminals: len(collection.Tests),
			PassedTestTerminals:   passedTerminals,
			FailedTestTerminals:   failedTerminals,
		},
		Commands: commands,
	}
	if err := emitJSONReport(stdout, opts.OutputPath, report); err != nil {
		fmt.Fprintf(stderr, "runtime-compliance: emit diagnostic report: %v\n", err)
		return 1
	}
	progress.Slowest(execution.Slowest)
	progress.Complete(fmt.Sprintf("profile=%s selected_test_refs=%d failed_test_refs=%d test_terminals=%d admission_eligible=false",
		opts.Profile, report.Summary.SelectedTestRefs, report.Summary.FailedTestRefs, report.Summary.ExecutedTestTerminals))
	if len(failedRefs) > 0 {
		fmt.Fprintf(stderr, "runtime-compliance: %d referenced test(s) missing or not passing: %s\n",
			len(failedRefs), strings.Join(failedRefs, ", "))
		return 1
	}
	return 0
}

func evaluateItem(
	item checklistItemSpec,
	passedTests map[string]bool,
	commandResults map[string]commandCheckResult,
) checklistItemResult {
	result := checklistItemResult{
		ID:          item.ID,
		Requirement: item.Requirement,
		Status:      "pass",
		Tests:       make([]string, 0, len(item.Tests)),
		FailedTests: []string{},
		Commands:    make([]commandCheckResult, 0, len(item.Commands)),
	}

	for _, ref := range item.Tests {
		key := ref.String()
		result.Tests = append(result.Tests, key)
		if !passedTests[key] {
			result.FailedTests = append(result.FailedTests, key)
			result.Status = "fail"
		}
	}

	for _, spec := range item.Commands {
		check, ok := commandResults[commandSpecKey(spec)]
		if !ok {
			check = commandCheckResult{
				Name:    spec.Name,
				Command: spec.Binary + " " + strings.Join(spec.Args, " "),
				Dir:     spec.Dir,
				Passed:  false,
				Detail:  "command result missing",
			}
		}
		result.Commands = append(result.Commands, check)
		if !check.Passed && !spec.AllowFail {
			result.Status = "fail"
		}
	}

	return result
}

func emitJSONReport(stdout io.Writer, outputPath string, report any) error {
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if _, err := fmt.Fprintln(stdout, string(raw)); err != nil {
		return fmt.Errorf("write stdout: %w", err)
	}
	if strings.TrimSpace(outputPath) == "" {
		return nil
	}
	dir := filepath.Dir(outputPath)
	if dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create output dir: %w", err)
		}
	}
	if err := os.WriteFile(outputPath, append(raw, '\n'), 0o644); err != nil {
		return fmt.Errorf("write output: %w", err)
	}
	return nil
}
