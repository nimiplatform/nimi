package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
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
	Name    string `json:"name"`
	Command string `json:"command"`
	Dir     string `json:"dir"`
	Passed  bool   `json:"passed"`
	Detail  string `json:"detail,omitempty"`
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
	GeneratedAt string                `json:"generated_at"`
	Summary     complianceSummary     `json:"summary"`
	Items       []checklistItemResult `json:"items"`
}

type complianceSummary struct {
	Total  int `json:"total"`
	Passed int `json:"passed"`
	Failed int `json:"failed"`
}

func main() {
	outputPath := flag.String("output", "", "optional path to write compliance report json")
	gate := flag.Bool("gate", false, "exit non-zero when any checklist item fails")
	flag.Parse()

	passedTests, testErr := collectPassingTests()
	if testErr != nil {
		fatalf("collect tests failed: %v", testErr)
	}

	checklist := runtimeChecklist()
	results := make([]checklistItemResult, 0, len(checklist))
	passCount := 0
	for _, item := range checklist {
		result := evaluateItem(item, passedTests)
		if result.Status == "pass" {
			passCount++
		}
		results = append(results, result)
	}

	report := complianceReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Summary: complianceSummary{
			Total:  len(results),
			Passed: passCount,
			Failed: len(results) - passCount,
		},
		Items: results,
	}

	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fatalf("marshal report failed: %v", err)
	}
	fmt.Println(string(raw))

	if strings.TrimSpace(*outputPath) != "" {
		if err := os.MkdirAll(filepath.Dir(*outputPath), 0o755); err != nil {
			fatalf("create output dir failed: %v", err)
		}
		if err := os.WriteFile(*outputPath, raw, 0o644); err != nil {
			fatalf("write output failed: %v", err)
		}
	}

	if *gate && report.Summary.Failed > 0 {
		fmt.Fprintf(os.Stderr, "gate failed: %d checklist item(s) did not pass\n", report.Summary.Failed)
		os.Exit(1)
	}
}

func evaluateItem(item checklistItemSpec, passedTests map[string]bool) checklistItemResult {
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
		result.Tests = append(result.Tests, ref.String())
		if !passedTests[key] {
			result.FailedTests = append(result.FailedTests, ref.String())
			result.Status = "fail"
		}
	}

	for _, spec := range item.Commands {
		check := runCommandCheck(spec)
		result.Commands = append(result.Commands, check)
		if !check.Passed && !spec.AllowFail {
			result.Status = "fail"
		}
	}

	return result
}

func reportMalformedTestEvents(count int) {
	if count > 0 {
		fmt.Fprintf(os.Stderr, "warning: ignored %d malformed go test event(s)\n", count)
	}
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
