package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"time"
)

type goTestEvent struct {
	Time    time.Time `json:"Time"`
	Action  string    `json:"Action"`
	Package string    `json:"Package"`
	Test    string    `json:"Test"`
	Elapsed float64   `json:"Elapsed"`
	Output  string    `json:"Output"`
}

type testCollectionRequest struct {
	Packages          []string
	RunPattern        string
	Args              []string
	DisplayArgs       []string
	PackageParallel   int
	TestParallel      int
	UsesWindowsSigner bool
}

type testCollectionResult struct {
	PassedTests     map[string]bool
	Packages        []packageTiming
	Tests           []testTiming
	MalformedEvents int
	StartedAt       time.Time
	FinishedAt      time.Time
	FirstOutput     time.Duration
	ExitCode        int
	DisplayArgs     []string
	PackageParallel int
	TestParallel    int
	WindowsSigner   bool
}

func (r testCollectionResult) FailedPackages() []string {
	failed := make([]string, 0)
	for _, pkg := range r.Packages {
		if pkg.TerminalAction == "fail" {
			failed = append(failed, pkg.Package)
		}
	}
	sort.Strings(failed)
	return failed
}

type goTestScanResult struct {
	PassedTests     map[string]bool
	Packages        []packageTiming
	Tests           []testTiming
	MalformedEvents int
	FirstOutput     time.Duration
}

func collectPassingTests(
	ctx context.Context,
	request testCollectionRequest,
	progress *progressReporter,
) (testCollectionResult, error) {
	progress.Phase("fresh_test_collection")
	startedAt := time.Now()
	cmd := exec.Command("go", request.Args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return testCollectionResult{}, fmt.Errorf("go test stdout pipe: %w", err)
	}
	stderr := &limitedBuffer{limit: maxCommandOutputBytes}
	cmd.Stderr = stderr
	configureProcessTree(cmd)
	if err := cmd.Start(); err != nil {
		return testCollectionResult{}, fmt.Errorf("start go test: %w", err)
	}

	scanDone := make(chan goTestScanResult, 1)
	go func() {
		scanDone <- scanGoTestJSON(stdout, startedAt, progress)
	}()
	timedOut, waitErr := waitManagedCommand(ctx, cmd, progress)
	scan := <-scanDone
	finishedAt := time.Now()
	exitCode := 0
	if waitErr != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	result := testCollectionResult{
		PassedTests:     scan.PassedTests,
		Packages:        scan.Packages,
		Tests:           scan.Tests,
		MalformedEvents: scan.MalformedEvents,
		StartedAt:       startedAt,
		FinishedAt:      finishedAt,
		FirstOutput:     scan.FirstOutput,
		ExitCode:        exitCode,
		DisplayArgs:     append([]string(nil), request.DisplayArgs...),
		PackageParallel: request.PackageParallel,
		TestParallel:    request.TestParallel,
		WindowsSigner:   request.UsesWindowsSigner,
	}
	if timedOut {
		return result, fmt.Errorf("go test timed out after %s; current phase/package was reported before process-tree termination", finishedAt.Sub(startedAt).Round(time.Millisecond))
	}
	if scan.MalformedEvents > 0 {
		return result, fmt.Errorf("malformed Go JSON events: %d (fail closed)", scan.MalformedEvents)
	}
	if waitErr != nil {
		detail := stderr.String()
		if detail == "" {
			detail = waitErr.Error()
		}
		return result, fmt.Errorf("go test exited nonzero (exit=%d): %s", exitCode, detail)
	}
	for _, pkg := range scan.Packages {
		if pkg.TerminalAction == "skip" && pkg.NoTestFiles {
			continue
		}
		if pkg.TerminalAction != "pass" {
			return result, fmt.Errorf("package %s terminal state is %s", pkg.Package, pkg.TerminalAction)
		}
	}
	return result, nil
}

func scanGoTestJSON(reader io.Reader, startedAt time.Time, progress *progressReporter) goTestScanResult {
	result := goTestScanResult{PassedTests: make(map[string]bool)}
	packageStarts := make(map[string]time.Time)
	packageByName := make(map[string]*packageTiming)
	firstOutputRecorded := false
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 1024), 2*1024*1024)
	for scanner.Scan() {
		now := time.Now()
		if !firstOutputRecorded {
			result.FirstOutput = now.Sub(startedAt)
			firstOutputRecorded = true
		}
		var event goTestEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			result.MalformedEvents++
			continue
		}
		packagePath := strings.TrimSpace(event.Package)
		if packagePath != "" && event.Action == "output" && strings.Contains(event.Output, "[no test files]") {
			ensurePackageTiming(packageByName, packagePath).NoTestFiles = true
		}
		if event.Action == "start" && packagePath != "" && strings.TrimSpace(event.Test) == "" {
			packageStarts[packagePath] = now
			if progress != nil {
				progress.Item("package", packagePath)
			}
		}
		if strings.TrimSpace(event.Test) != "" {
			key := packagePath + ":" + event.Test
			switch event.Action {
			case "pass":
				result.PassedTests[key] = true
			case "fail":
				pkg := ensurePackageTiming(packageByName, packagePath)
				pkg.FailedTests = appendUnique(pkg.FailedTests, event.Test)
			}
			if event.Action == "pass" || event.Action == "fail" || event.Action == "skip" {
				result.Tests = append(result.Tests, testTiming{
					Package:        packagePath,
					Test:           event.Test,
					TerminalAction: event.Action,
					ElapsedSeconds: event.Elapsed,
				})
			}
			continue
		}
		if packagePath == "" || (event.Action != "pass" && event.Action != "fail" && event.Action != "skip") {
			continue
		}
		pkg := ensurePackageTiming(packageByName, packagePath)
		pkg.TerminalAction = event.Action
		pkg.ElapsedSeconds = event.Elapsed
		elapsed := time.Duration(event.Elapsed * float64(time.Second))
		if start, ok := packageStarts[packagePath]; ok {
			wall := now.Sub(start)
			if wall > elapsed {
				elapsed = wall
				pkg.ElapsedSeconds = wall.Seconds()
			}
		}
		if progress != nil {
			progress.ItemDone("package", packagePath, elapsed, event.Action)
		}
	}
	if scanner.Err() != nil {
		result.MalformedEvents++
	}
	for _, pkg := range packageByName {
		sort.Strings(pkg.FailedTests)
		result.Packages = append(result.Packages, *pkg)
	}
	sort.Slice(result.Packages, func(i int, j int) bool {
		return result.Packages[i].Package < result.Packages[j].Package
	})
	sort.Slice(result.Tests, func(i int, j int) bool {
		if result.Tests[i].Package == result.Tests[j].Package {
			return result.Tests[i].Test < result.Tests[j].Test
		}
		return result.Tests[i].Package < result.Tests[j].Package
	})
	return result
}

func ensurePackageTiming(packages map[string]*packageTiming, packagePath string) *packageTiming {
	if existing, ok := packages[packagePath]; ok {
		return existing
	}
	created := &packageTiming{Package: packagePath, TerminalAction: "missing"}
	packages[packagePath] = created
	return created
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func fullCollectionRequest() testCollectionRequest {
	return newTestCollectionRequestWithMode([]string{"./..."}, "", 1, 1, goruntime.GOOS == "windows")
}

func newTestCollectionRequest(packages []string, runPattern string) testCollectionRequest {
	return newTestCollectionRequestWithMode(packages, runPattern, 1, 1, goruntime.GOOS == "windows")
}

func newTestCollectionRequestWithMode(
	packages []string,
	runPattern string,
	packageParallel int,
	testParallel int,
	useWindowsSigner bool,
) testCollectionRequest {
	args := make([]string, 0, 12+len(packages))
	args = append(args, "test")
	if goruntime.GOOS == "windows" && useWindowsSigner {
		args = append(args, "-exec", windowsGoTestExecSignerPath())
	}
	args = append(args, fmt.Sprintf("-p=%d", packageParallel), fmt.Sprintf("-parallel=%d", testParallel))
	args = append(args, packages...)
	if runPattern != "" {
		args = append(args, "-run", runPattern)
	}
	args = append(args, "-json", "-count=1")
	return testCollectionRequest{
		Packages:          append([]string(nil), packages...),
		RunPattern:        runPattern,
		Args:              args,
		DisplayArgs:       append([]string(nil), args...),
		PackageParallel:   packageParallel,
		TestParallel:      testParallel,
		UsesWindowsSigner: goruntime.GOOS == "windows" && useWindowsSigner,
	}
}

func goTestCollectionArgs() []string {
	return fullCollectionRequest().Args
}

func windowsGoTestExecSignerPath() string {
	_, sourcePath, _, ok := goruntime.Caller(0)
	if !ok {
		return filepath.Join("scripts", "windows-go-test-exec-signer.cmd")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), "..", "..", ".."))
	return filepath.Join(repoRoot, "scripts", "windows-go-test-exec-signer.cmd")
}
