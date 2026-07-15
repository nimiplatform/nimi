package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"
	"time"
)

type cliOptions struct {
	OutputPath             string
	Gate                   bool
	Profile                string
	Packages               stringListFlag
	Tests                  stringListFlag
	DiagnosticRetryFailure bool
	Timeout                time.Duration
	Help                   bool
}

type stringListFlag []string

type durationFlag struct {
	value time.Duration
	set   bool
}

func (f *durationFlag) String() string {
	if !f.set {
		return ""
	}
	return f.value.String()
}

func (f *durationFlag) Set(value string) error {
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return err
	}
	f.value = parsed
	f.set = true
	return nil
}

func (f *stringListFlag) String() string { return strings.Join(*f, ",") }

func (f *stringListFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("value must not be empty")
	}
	*f = append(*f, value)
	return nil
}

func parseCLIOptions(args []string) (cliOptions, string, error) {
	opts := cliOptions{Profile: profileFull}
	timeout := durationFlag{}
	fs := flag.NewFlagSet("runtime-compliance", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&opts.OutputPath, "output", "", "optional path to write the JSON report")
	fs.BoolVar(&opts.Gate, "gate", false, "run the final full admission gate and exit non-zero on any failure")
	fs.StringVar(&opts.Profile, "profile", profileFull, "execution profile: full, fast, developer, or owner-batch")
	fs.Var(&opts.Packages, "package", "diagnostic package selector; repeatable (full import path or runtime-relative suffix)")
	fs.Var(&opts.Tests, "test", "diagnostic referenced-test selector; repeatable exact checklist test name")
	fs.BoolVar(&opts.DiagnosticRetryFailure, "diagnostic-retry-failures", false, "rerun failed diagnostic packages once without changing the failing result")
	fs.Var(&timeout, "timeout", "overall execution timeout; the full default is 20m")
	fs.BoolVar(&opts.Help, "help", false, "print help")
	fs.BoolVar(&opts.Help, "h", false, "print help")
	if err := fs.Parse(args); err != nil {
		return cliOptions{}, cliUsage(), err
	}
	opts.Profile = strings.TrimSpace(opts.Profile)
	switch opts.Profile {
	case profileFull, profileFast, profileDeveloper, profileOwnerBatch:
	default:
		return cliOptions{}, cliUsage(), fmt.Errorf("unknown profile %q", opts.Profile)
	}
	if timeout.set {
		opts.Timeout = timeout.value
	} else if opts.Profile == profileFull {
		opts.Timeout = defaultFullTimeout
	} else {
		opts.Timeout = defaultDiagnosticLimit
	}
	if opts.Timeout <= 0 {
		return cliOptions{}, cliUsage(), errors.New("--timeout must be greater than zero")
	}
	if opts.Gate && opts.Profile != profileFull {
		return cliOptions{}, cliUsage(), errors.New("--gate requires --profile=full; diagnostic profiles are never admission eligible")
	}
	if opts.Profile == profileFull && (len(opts.Packages) > 0 || len(opts.Tests) > 0) {
		return cliOptions{}, cliUsage(), errors.New("--package/--test require a diagnostic profile; the full profile always runs ./...")
	}
	if opts.Profile == profileFull && opts.DiagnosticRetryFailure {
		return cliOptions{}, cliUsage(), errors.New("--diagnostic-retry-failures is forbidden for the full profile")
	}
	if opts.Profile == profileFast && (len(opts.Packages) > 0 || len(opts.Tests) > 0) {
		return cliOptions{}, cliUsage(), errors.New("--profile=fast uses the audited isolated package set; --package/--test are not allowed")
	}
	if fs.NArg() > 0 {
		return cliOptions{}, cliUsage(), fmt.Errorf("unexpected positional arguments: %s", strings.Join(fs.Args(), " "))
	}
	return opts, cliUsage(), nil
}

func cliUsage() string {
	return `Usage: go run ./cmd/runtime-compliance [options]

Profiles:
  --profile=full         Fresh, source-bound full Runtime regression plus all 63
                         compliance items and command checks. This is the only
                         profile permitted with --gate and the only admission-
                         eligible result.
  --profile=fast         Diagnostic-only fresh unit suite for an audited,
                         resource-isolated package set. It uses bounded safe
                         parallelism and excludes signer/service integration.
  --profile=developer    Diagnostic referenced-test loop. Use repeatable
                         --package selectors for all tests in an affected owner
                         package, or --test for exact checklist references.
                         It never emits 63/63 or final acceptance evidence.
  --profile=owner-batch  Diagnostic Runtime owner batch: go build, go vet, then
                         fresh affected-package tests selected like developer.

Layering discipline:
  Runtime fast suite:    --profile=fast
  Targeted owner loop:  --profile=developer --package <affected-package>
  Runtime owner batch:  --profile=owner-batch --package <affected-package>
  Candidate/admission:  --gate (exactly once; never for Desktop/Zhiyu/Kit-only work)

Options:
  --gate                         Final full admission semantics; profile must be full.
  --output <path>                Also write the stdout JSON report to a file.
  --package <selector>           Repeatable diagnostic package selector; without
                                 --test it executes every test in that package.
  --test <exact-name>            Repeatable exact checklist test selector.
  --diagnostic-retry-failures    Diagnostic-only failed-package rerun; initial
                                 failure remains failure and cannot be admitted.
  --timeout <duration>           Overall timeout (full default 20m; diagnostic 10m).
  --help, -h                     Print this help.

Progress is written only to stderr. Stdout remains one machine-readable JSON report.
Full execution remains -p=1/-parallel=1 until daemon, engine, protected-local,
service/process, global-environment, port, signer, and shared-root packages have
package-level isolation evidence and repeated stability proof.
`
}
