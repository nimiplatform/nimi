package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestResolveBinaryRejectsDisallowedName(t *testing.T) {
	if _, err := resolveBinary("python3"); err == nil {
		t.Fatal("expected disallowed binary error")
	}
}

func TestLimitedBufferTruncatesOutput(t *testing.T) {
	buffer := &limitedBuffer{limit: 8}
	if _, err := buffer.Write([]byte("1234567890")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got := buffer.String()
	if !strings.Contains(got, "...(truncated)") {
		t.Fatalf("expected truncated suffix, got %q", got)
	}
	if !strings.HasPrefix(got, "12345678") {
		t.Fatalf("expected preserved prefix, got %q", got)
	}
}

func TestFullGoTestCollectionArgsStayFreshFullAndSerial(t *testing.T) {
	args := goTestCollectionArgs()
	for _, required := range []string{"-p=1", "-parallel=1", "./...", "-json", "-count=1"} {
		if !slices.Contains(args, required) {
			t.Fatalf("expected full runtime-compliance args to contain %q, got %v", required, args)
		}
	}
	if slices.Contains(args, "-run") {
		t.Fatalf("full gate must not narrow tests with -run: %v", args)
	}
	if runtime.GOOS == "windows" {
		index := slices.Index(args, "-exec")
		if index < 0 || index+1 >= len(args) {
			t.Fatalf("Windows full gate must use signer exec: %v", args)
		}
		if _, err := os.Stat(args[index+1]); err != nil {
			t.Fatalf("Windows signer path is not a file: %v", err)
		}
	}
}

func TestFastProfileUsesOnlyAuditedParallelUnitSet(t *testing.T) {
	request := fastCollectionRequest()
	for _, required := range []string{"-p=4", "-parallel=4", "-json", "-count=1"} {
		if !slices.Contains(request.Args, required) {
			t.Fatalf("fast args missing %q: %v", required, request.Args)
		}
	}
	if slices.Contains(request.Args, "-exec") || request.UsesWindowsSigner {
		t.Fatalf("fast profile must exclude signer integration: %v", request.Args)
	}
	if len(request.Packages) != len(fastProfilePackages) {
		t.Fatalf("fast package set drift: got %d want %d", len(request.Packages), len(fastProfilePackages))
	}

	runtimeRoot := filepath.Clean(filepath.Join("..", ".."))
	forbidden := []string{
		"net.Listen", "httptest.", "exec.Command", "CommandContext",
		"t.Setenv", "os.Setenv", "t.TempDir", "os.WriteFile", "os.Mkdir",
		"os.Open", "os.Remove", "os.Chdir", "filepath.",
	}
	for _, packagePath := range fastProfilePackages {
		relative := strings.TrimPrefix(packagePath, runtimeModulePrefix)
		entries, err := os.ReadDir(filepath.Join(runtimeRoot, filepath.FromSlash(relative)))
		if err != nil {
			t.Fatalf("read isolated package %s: %v", packagePath, err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(runtimeRoot, filepath.FromSlash(relative), entry.Name()))
			if err != nil {
				t.Fatal(err)
			}
			for _, token := range forbidden {
				if strings.Contains(string(raw), token) {
					t.Fatalf("fast package %s gained shared-resource token %q in %s; isolation must be re-audited",
						packagePath, token, entry.Name())
				}
			}
		}
	}
}

func TestOwnerPackageSelectionRunsEveryFreshPackageTest(t *testing.T) {
	request, err := diagnosticPackageCollectionRequest([]string{"internal/streamutil"})
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"./internal/streamutil", "-p=1", "-parallel=1", "-json", "-count=1"} {
		if !slices.Contains(request.Args, required) {
			t.Fatalf("owner package args missing %q: %v", required, request.Args)
		}
	}
	if slices.Contains(request.Args, "-run") {
		t.Fatalf("package-only owner loop must not narrow package tests: %v", request.Args)
	}
	refs := referencedTestsForPackages(runtimeChecklist(), []string{"internal/streamutil"})
	if len(refs) == 0 {
		t.Fatal("owner package lost its compliance-referenced test binding")
	}
}

func TestFullChecklistStillHas63ItemsAndOwnsBuildVet(t *testing.T) {
	checklist := runtimeChecklist()
	if len(checklist) != 63 {
		t.Fatalf("full checklist count changed: got %d want 63", len(checklist))
	}
	var item checklistItemSpec
	for _, candidate := range checklist {
		if candidate.ID == "RS-11-41" {
			item = candidate
			break
		}
	}
	if item.ID == "" {
		t.Fatal("RS-11-41 missing")
	}
	commands := make([]string, 0, len(item.Commands))
	for _, command := range item.Commands {
		commands = append(commands, command.Binary+" "+strings.Join(command.Args, " "))
	}
	for _, required := range []string{"go build ./...", "go vet ./..."} {
		if !slices.Contains(commands, required) {
			t.Fatalf("full gate does not own %q: %v", required, commands)
		}
	}
}

func TestDiagnosticProfileCannotBecomeGate(t *testing.T) {
	_, _, err := parseCLIOptions([]string{"--profile=developer", "--gate"})
	if err == nil || !strings.Contains(err.Error(), "never admission eligible") {
		t.Fatalf("expected diagnostic gate rejection, got %v", err)
	}
}

func TestProfileTimeoutDefaultsAndExplicitOverride(t *testing.T) {
	full, _, err := parseCLIOptions(nil)
	if err != nil {
		t.Fatal(err)
	}
	if full.Timeout != defaultFullTimeout {
		t.Fatalf("full timeout = %s, want %s", full.Timeout, defaultFullTimeout)
	}

	diagnostic, _, err := parseCLIOptions([]string{"--profile=developer"})
	if err != nil {
		t.Fatal(err)
	}
	if diagnostic.Timeout != defaultDiagnosticLimit {
		t.Fatalf("diagnostic timeout = %s, want %s", diagnostic.Timeout, defaultDiagnosticLimit)
	}

	explicit, _, err := parseCLIOptions([]string{"--profile=developer", "--timeout=20m"})
	if err != nil {
		t.Fatal(err)
	}
	if explicit.Timeout != 20*time.Minute {
		t.Fatalf("explicit timeout was overwritten: %s", explicit.Timeout)
	}
}

func TestDiagnosticReportCannotClaim63OrAdmission(t *testing.T) {
	report := diagnosticReport{
		SchemaVersion:     diagnosticReportSchema,
		Profile:           profileDeveloper,
		AdmissionEligible: false,
		Summary: diagnosticSummary{
			SelectedTestRefs: 2,
			PassedTestRefs:   2,
		},
	}
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, "63/63") || strings.Contains(text, `"total":63`) {
		t.Fatalf("diagnostic report impersonated full compliance: %s", text)
	}
	if strings.Contains(text, `"admission_eligible":true`) {
		t.Fatalf("diagnostic report became admission eligible: %s", text)
	}
}

func TestProgressWritesPhasePackageElapsedToStderrWriter(t *testing.T) {
	var stderr bytes.Buffer
	started := time.Now().Add(-2 * time.Second)
	progress := newProgressReporter(&stderr, started)
	progress.Phase("fresh_test_collection")
	progress.Item("package", "example/runtime/pkg")
	progress.ItemDone("package", "example/runtime/pkg", 1250*time.Millisecond, "pass")
	text := stderr.String()
	for _, expected := range []string{
		"phase=fresh_test_collection",
		"item=example/runtime/pkg",
		"phase_elapsed=",
		"total_elapsed=",
		"item_elapsed=1.25s",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("progress missing %q:\n%s", expected, text)
		}
	}
}

func TestTimeoutProgressKeepsCurrentPhaseAndPackage(t *testing.T) {
	var stderr bytes.Buffer
	progress := newProgressReporter(&stderr, time.Now())
	progress.Phase("fresh_full_test_collection")
	progress.Item("package", "example/runtime/daemon")
	progress.Timeout()
	lines := strings.Split(strings.TrimSpace(stderr.String()), "\n")
	last := lines[len(lines)-1]
	for _, expected := range []string{
		"phase=fresh_full_test_collection",
		"item=example/runtime/daemon",
		"status=timeout",
		"process_tree_kill=attempted",
	} {
		if !strings.Contains(last, expected) {
			t.Fatalf("timeout progress missing %q: %s", expected, last)
		}
	}
}

func TestRetryProgressNamesExactDiagnosticReason(t *testing.T) {
	var stderr bytes.Buffer
	progress := newProgressReporter(&stderr, time.Now())
	progress.Phase("fresh_test_collection")
	progress.Retry("initial_go_test_nonzero", []string{"pkg/b", "pkg/a"})
	text := stderr.String()
	for _, expected := range []string{
		"status=retry",
		"reason=initial_go_test_nonzero",
		"packages=pkg/a,pkg/b",
		"admission_effect=none",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("retry progress missing %q: %s", expected, text)
		}
	}
}

func TestEmitJSONReportDoesNotWriteProgress(t *testing.T) {
	var stdout bytes.Buffer
	report := diagnosticReport{SchemaVersion: diagnosticReportSchema, AdmissionEligible: false}
	if err := emitJSONReport(&stdout, "", report); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stdout.String(), "[runtime-compliance]") || strings.Contains(stdout.String(), "phase=") {
		t.Fatalf("stdout JSON was polluted by progress: %s", stdout.String())
	}
	var decoded map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &decoded); err != nil {
		t.Fatalf("stdout is not one JSON document: %v\n%s", err, stdout.String())
	}
}

func TestCallSitesKeepFullAdmissionAndAvoidDuplicateCoreCommands(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	for _, relative := range []string{
		".github/workflows/ci.yml",
		".github/workflows/assurance.yml",
		".github/workflows/release-runtime.yml",
	} {
		raw, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(relative)))
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		if !strings.Contains(text, "go run ./cmd/runtime-compliance --gate") {
			t.Fatalf("%s no longer calls the full gate", relative)
		}
		for _, duplicate := range []string{"run: go build ./...", "run: go vet ./...", "run: go test ./..."} {
			if strings.Contains(text, duplicate) {
				t.Fatalf("%s still duplicates full gate work with %q", relative, duplicate)
			}
		}
	}
}

func TestReleaseRegistryMakesComplianceSoleFinalRuntimeCoreOrchestrator(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	raw, err := os.ReadFile(filepath.Join(repoRoot, ".nimi", "spec", "platform", "kernel", "tables", "release-gate-registry.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, id := range []string{"gate.runtime.go-build", "gate.runtime.go-vet", "gate.runtime.go-test"} {
		if strings.Contains(text, "  - id: "+id+"\n") {
			t.Fatalf("%s must not remain as a second Runtime core orchestrator", id)
		}
	}
	compliance := registryGateSection(t, text, "gate.runtime.compliance")
	for _, required := range []string{
		"go run ./cmd/runtime-compliance --gate",
		"tiers: [release, release-target:runtime]",
		"timeout_seconds: 1500",
	} {
		if !strings.Contains(compliance, required) {
			t.Fatalf("compliance registry row missing %q:\n%s", required, compliance)
		}
	}
}

func registryGateSection(t *testing.T, registry string, id string) string {
	t.Helper()
	startToken := "  - id: " + id + "\n"
	start := strings.Index(registry, startToken)
	if start < 0 {
		t.Fatalf("registry gate %s missing", id)
	}
	rest := registry[start+len(startToken):]
	end := strings.Index(rest, "\n  - id: ")
	if end < 0 {
		end = len(rest)
	}
	return startToken + rest[:end]
}

func TestDesktopZhiyuOnlyPathsDoNotSelectRuntimeQuality(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	raw, err := os.ReadFile(filepath.Join(repoRoot, ".github", "workflows", "ci.yml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, `if [[ "${file}" =~ ^runtime/ || "${file}" =~ ^proto/ || "${file}" == ".goreleaser.yml" ]]; then`) {
		t.Fatal("runtime_changed path ownership is no longer restricted to Runtime/proto/release config")
	}
	if !strings.Contains(text, "if: needs.changes.outputs.runtime_changed == 'true'") {
		t.Fatal("runtime-quality job is not gated on runtime_changed")
	}
}

func TestRuntimePackageScriptsExposeLayeredCommandsWithoutSecondFullRunner(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	raw, err := os.ReadFile(filepath.Join(repoRoot, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, required := range []string{
		`"test:runtime:fast": "cd runtime && go run ./cmd/runtime-compliance --profile=fast"`,
		`"test:runtime:owner:nimillm": "cd runtime && go run ./cmd/runtime-compliance --profile=owner-batch --package internal/nimillm"`,
		`"test:runtime:owner:localservice": "cd runtime && go run ./cmd/runtime-compliance --profile=owner-batch --package internal/services/localservice"`,
		`"test:runtime:full": "cd runtime && go run ./cmd/runtime-compliance --gate"`,
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("runtime layered package script missing: %s", required)
		}
	}
}
