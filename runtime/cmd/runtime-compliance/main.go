package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type testRef struct {
	Package string
	Name    string
}

func (r testRef) key() string {
	return r.Package + ":" + r.Name
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

type goTestEvent struct {
	Action  string `json:"Action"`
	Package string `json:"Package"`
	Test    string `json:"Test"`
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
		fmt.Fprintf(os.Stderr, "collect tests failed: %v\n", testErr)
		os.Exit(1)
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
		fmt.Fprintf(os.Stderr, "marshal report failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(string(raw))

	if strings.TrimSpace(*outputPath) != "" {
		if err := os.MkdirAll(filepath.Dir(*outputPath), 0o755); err != nil {
			fmt.Fprintf(os.Stderr, "create output dir failed: %v\n", err)
			os.Exit(1)
		}
		if err := os.WriteFile(*outputPath, raw, 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "write output failed: %v\n", err)
			os.Exit(1)
		}
	}

	if *gate && report.Summary.Failed > 0 {
		os.Exit(1)
	}
}

func collectPassingTests() (map[string]bool, error) {
	cmd := exec.Command("go", "test", "./...", "-json", "-count=1")
	cmd.Dir = "."
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	passed := make(map[string]bool)
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024), 2*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		var event goTestEvent
		if err := json.Unmarshal(line, &event); err != nil {
			continue
		}
		if event.Action == "pass" && strings.TrimSpace(event.Test) != "" {
			passed[event.Package+":"+event.Test] = true
		}
	}
	if scanErr := scanner.Err(); scanErr != nil {
		return nil, scanErr
	}
	if waitErr := cmd.Wait(); waitErr != nil {
		return nil, waitErr
	}
	return passed, nil
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
		key := ref.key()
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

func runCommandCheck(spec commandCheckSpec) commandCheckResult {
	result := commandCheckResult{
		Name:    spec.Name,
		Command: spec.Binary + " " + strings.Join(spec.Args, " "),
		Dir:     spec.Dir,
		Passed:  false,
	}

	binaryPath, err := resolveBinary(spec.Binary)
	if err != nil {
		result.Detail = err.Error()
		return result
	}

	cmd := exec.Command(binaryPath, spec.Args...)
	if strings.TrimSpace(spec.Dir) != "" {
		cmd.Dir = spec.Dir
	}
	raw, err := cmd.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(raw))
		if detail == "" {
			detail = err.Error()
		}
		if len(detail) > 800 {
			detail = detail[:800] + "...(truncated)"
		}
		result.Detail = detail
		return result
	}
	result.Passed = true
	return result
}

func resolveBinary(name string) (string, error) {
	if strings.TrimSpace(name) == "" {
		return "", errors.New("empty binary name")
	}
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}
	if name == "buf" {
		out, err := exec.Command("go", "env", "GOPATH").Output()
		if err == nil {
			candidate := filepath.Join(strings.TrimSpace(string(out)), "bin", "buf")
			if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("binary %q not found", name)
}

func runtimeChecklist() []checklistItemSpec {
	const (
		pkgAppRegistry = "github.com/nimiplatform/nimi/runtime/internal/appregistry"
		pkgAuditLog    = "github.com/nimiplatform/nimi/runtime/internal/auditlog"
		pkgAuditSvc    = "github.com/nimiplatform/nimi/runtime/internal/services/audit"
		pkgAI          = "github.com/nimiplatform/nimi/runtime/internal/services/ai"
		pkgGrant       = "github.com/nimiplatform/nimi/runtime/internal/services/grant"
		pkgGrpc        = "github.com/nimiplatform/nimi/runtime/internal/grpcserver"
		pkgModel       = "github.com/nimiplatform/nimi/runtime/internal/services/model"
		pkgNimillm     = "github.com/nimiplatform/nimi/runtime/internal/nimillm"
		pkgScheduler   = "github.com/nimiplatform/nimi/runtime/internal/scheduler"
		pkgWorkflow    = "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	)

	return []checklistItemSpec{
		{
			ID:          "RS-11-01",
			Requirement: "gRPC schema freeze + breaking-change check",
			Commands: []commandCheckSpec{
				{Name: "buf-build", Dir: "../proto", Binary: "buf", Args: []string{"build"}},
				{Name: "buf-breaking", Dir: "../proto", Binary: "buf", Args: []string{"breaking", "--against", "../runtime/proto/runtime-v1.baseline.binpb"}},
			},
		},
		{
			ID:          "RS-11-02",
			Requirement: "strict-only version negotiation",
			Tests: []testRef{
				{Package: pkgGrpc, Name: "TestUnaryProtocolInterceptorRejectsMissingMetadata"},
				{Package: pkgGrpc, Name: "TestUnaryProtocolInterceptorRejectsVersionMinorMismatch"},
			},
		},
		{
			ID:          "RS-11-03",
			Requirement: "auth/grant chain tests",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestGrantAuthorizeValidateRevoke"},
			},
		},
		{
			ID:          "RS-11-04",
			Requirement: "ExternalPrincipal -> App authorization (preset + custom)",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestGrantAuthorizeValidateRevoke"},
				{Package: pkgGrant, Name: "TestGrantResourceSelectorsSubsetAndOutOfScopeDeny"},
			},
		},
		{
			ID:          "RS-11-05",
			Requirement: "token delegation (subset + ttl + depth + cascade revoke)",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestGrantDelegateChain"},
			},
		},
		{
			ID:          "RS-11-06",
			Requirement: "delegate second-hop rejected",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestGrantDelegateChain"},
			},
		},
		{
			ID:          "RS-11-07",
			Requirement: "resource selector subset + out-of-scope deny",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestGrantResourceSelectorsSubsetAndOutOfScopeDeny"},
			},
		},
		{
			ID:          "RS-11-08",
			Requirement: "consent required + consent invalid deny",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestGrantAuthorizeRejectsMissingOrInvalidConsent"},
			},
		},
		{
			ID:          "RS-11-09",
			Requirement: "policy update invalidates existing token immediately",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestGrantPolicyUpdateInvalidatesExistingToken"},
			},
		},
		{
			ID:          "RS-11-10",
			Requirement: "app mode violations (domain/scope/worldRelation/manifest)",
			Tests: []testRef{
				{Package: pkgAppRegistry, Name: "TestValidateManifestRejectsLiteExtensionWorldRelation"},
				{Package: pkgAppRegistry, Name: "TestValidateDomainAndScopesRejectsModeViolationsWithActionHint"},
			},
		},
		{
			ID:          "RS-11-11",
			Requirement: "app mode actionHint mapping",
			Tests: []testRef{
				{Package: pkgAppRegistry, Name: "TestValidateDomainAndScopesRejectsModeViolationsWithActionHint"},
			},
		},
		{
			ID:          "RS-11-12",
			Requirement: "Generate/StreamGenerate request/response schema",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestGenerateSuccess"},
				{Package: pkgAI, Name: "TestStreamGenerateSequence"},
			},
		},
		{
			ID:          "RS-11-13",
			Requirement: "stream envelope contract",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestStreamGenerateSequence"},
			},
		},
		{
			ID:          "RS-11-14",
			Requirement: "AI reason-code mapping (timeout/unavailable/filter/auth/rate-limit/internal)",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestStreamGenerateTimeoutEmitsFailedEvent"},
				{Package: pkgAI, Name: "TestMapProviderHTTPErrorContentFilter"},
				{Package: pkgAI, Name: "TestOpenAIBackendStreamGenerateBrokenChunk"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderAuthFailed"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderRateLimited"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderInternal"},
			},
		},
		{
			ID:          "RS-11-15",
			Requirement: "AI route policy regression (explicit route + no silent fallback)",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestGenerateFallbackDenied"},
				{Package: pkgAI, Name: "TestCloudProviderRoutesByPrefix"},
			},
		},
		{
			ID:          "RS-11-16",
			Requirement: "model management contract (pull/list/remove/health)",
			Tests: []testRef{
				{Package: pkgModel, Name: "TestModelLifecycle"},
				{Package: pkgModel, Name: "TestModelRegistryPersistence"},
			},
		},
		{
			ID:          "RS-11-17",
			Requirement: "attribution metadata regression (callerKind/callerId/surfaceId)",
			Tests: []testRef{
				{Package: pkgGrpc, Name: "TestUnaryAuditInterceptorCapturesCallerMetadataForAI"},
				{Package: pkgGrpc, Name: "TestStreamAuditInterceptorCapturesCallerMetadataForAI"},
			},
		},
		{
			ID:          "RS-11-18",
			Requirement: "ListUsageStats consistency (desktop/mod/third-party)",
			Tests: []testRef{
				{Package: pkgAuditLog, Name: "TestStoreListUsageByCallerKindAndCapability"},
			},
		},
		{
			ID:          "RS-11-19",
			Requirement: "GetRuntimeHealth/SubscribeRuntimeHealthEvents contract",
			Tests: []testRef{
				{Package: pkgAuditSvc, Name: "TestGetRuntimeHealthContract"},
				{Package: pkgAuditSvc, Name: "TestSubscribeRuntimeHealthEvents"},
			},
		},
		{
			ID:          "RS-11-20",
			Requirement: "DAG state machine",
			Tests: []testRef{
				{Package: pkgWorkflow, Name: "TestWorkflowSubmitGetSubscribe"},
				{Package: pkgWorkflow, Name: "TestWorkflowCancel"},
			},
		},
		{
			ID:          "RS-11-21",
			Requirement: "GPU arbitration regression",
			Tests: []testRef{
				{Package: pkgScheduler, Name: "TestSchedulerPerAppConcurrencyIsolation"},
				{Package: pkgScheduler, Name: "TestSchedulerMarksStarvationWhenWaitExceedsThreshold"},
			},
		},
		{
			ID:          "RS-11-22",
			Requirement: "audit field completeness",
			Tests: []testRef{
				{Package: pkgGrpc, Name: "TestUnaryAuditInterceptorCapturesGrantAuditFields"},
			},
		},
		{
			ID:          "RS-11-23",
			Requirement: "local-runtime and token-api routing regression",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestCloudProviderRoutesByPrefix"},
				{Package: pkgAI, Name: "TestGenerateSuccess"},
			},
		},
		{
			ID:          "RS-11-24",
			Requirement: "cloud-nimillm naming unified (no cloud-litellm or legacy alias)",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestCloudProviderPickBackend"},
				{Package: pkgAI, Name: "TestCloudProviderRoutesByPrefix"},
			},
		},
		{
			ID:          "RS-11-25",
			Requirement: "no legacy litellm references outside explicit reject allowlist (zero-legacy static scan)",
			Commands: []commandCheckSpec{
				{
					Name:   "legacy-cloud-provider-key-scan",
					Dir:    "..",
					Binary: "node",
					Args:   []string{"scripts/check-no-legacy-cloud-provider-keys.mjs"},
				},
			},
		},
		{
			ID:          "RS-11-26",
			Requirement: "error-mapping-matrix provider error classification",
			Tests: []testRef{
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderAuthFailed"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderRateLimited"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderInternal"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderUnavailable"},
				{Package: pkgNimillm, Name: "TestMapProviderRequestError_DeadlineExceeded"},
			},
		},
		{
			ID:          "RS-11-27",
			Requirement: "media job reason code coverage",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestMediaJobReasonCodeClassification/GetMediaJob_NotFound_ReasonCode"},
				{Package: pkgAI, Name: "TestMediaJobReasonCodeClassification/CancelMediaJob_NotFound_ReasonCode"},
				{Package: pkgAI, Name: "TestMediaJobReasonCodeClassification/CancelMediaJob_NotCancellable_ReasonCode"},
				{Package: pkgAI, Name: "TestMediaJobReasonCodeClassification/SubmitMediaJob_SpecInvalid_MissingSpec"},
				{Package: pkgAI, Name: "TestMediaJobReasonCodeClassification/SubmitMediaJob_OptionUnsupported_ImageN"},
			},
		},
		{
			ID:          "RS-11-28",
			Requirement: "workflow reason code coverage",
			Tests: []testRef{
				{Package: pkgWorkflow, Name: "TestValidateDefinitionRejectsDuplicateInputSlot"},
				{Package: pkgWorkflow, Name: "TestValidateDefinitionRejectsCycle"},
				{Package: pkgWorkflow, Name: "TestValidateDefinitionRejectsMergeNOfMOutOfRange"},
				{Package: pkgWorkflow, Name: "TestGetWorkflowNotFoundReasonCode"},
				{Package: pkgWorkflow, Name: "TestCancelWorkflowNotFoundReasonCode"},
			},
		},
		{
			ID:          "RS-11-29",
			Requirement: "grant token chain reason code coverage",
			Tests: []testRef{
				{Package: pkgGrant, Name: "TestListTokenChainRootRequiredReasonCode"},
				{Package: pkgGrant, Name: "TestListTokenChainRootNotFoundReasonCode"},
			},
		},
	}
}
