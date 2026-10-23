package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
)

type daemonManager interface {
	Start(timeout time.Duration) (daemonctl.StartResult, error)
	Stop(timeout time.Duration) (daemonctl.StopResult, error)
	Status() (daemonctl.Status, error)
	PrintLogs(ctx context.Context, w io.Writer, tail int, follow bool) error
}

var daemonManagerFactory = func() daemonManager {
	return daemonctl.NewManager(Version)
}

type cliExitError struct {
	code  int
	cause error
}

func (e cliExitError) Error() string {
	if e.cause == nil {
		return ""
	}
	return e.cause.Error()
}

func (e cliExitError) ExitCode() int {
	if e.code <= 0 {
		return 1
	}
	return e.code
}

func runRuntimeStart(args []string) error {
	fs := flag.NewFlagSet("nimi start", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	timeoutRaw := fs.String("timeout", "15s", "startup timeout")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	result, err := daemonManagerFactory().Start(timeout)
	if err != nil {
		return err
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	printCLIHeader(os.Stdout, "Started Nimi Runtime")
	printCLIField(os.Stdout, "mode", result.Mode.String())
	printCLIField(os.Stdout, "pid", fmt.Sprintf("%d", result.PID))
	if strings.TrimSpace(result.Version) != "" {
		printCLIField(os.Stdout, "version", result.Version)
	}
	if strings.TrimSpace(result.HealthSummary) != "" {
		printCLIField(os.Stdout, "health", result.HealthSummary)
	}
	return nil
}

func runRuntimeStop(args []string) error {
	fs := flag.NewFlagSet("nimi stop", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	timeoutRaw := fs.String("timeout", "10s", "shutdown timeout")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	result, err := daemonManagerFactory().Stop(timeout)
	if err != nil {
		return err
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	if result.AlreadyStopped {
		printCLIHeader(os.Stdout, "Nimi Runtime")
		printCLIField(os.Stdout, "process", "stopped")
		printCLINextStep(os.Stdout, "nimi start")
		return nil
	}
	printCLIHeader(os.Stdout, "Stopped Nimi Runtime")
	printCLIField(os.Stdout, "pid", fmt.Sprintf("%d", result.PID))
	if strings.TrimSpace(result.Mode.String()) != "" {
		printCLIField(os.Stdout, "mode", result.Mode.String())
	}
	return nil
}

func runRuntimeStatus(args []string) error {
	fs := flag.NewFlagSet("nimi status", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	status, err := daemonManagerFactory().Status()
	if err != nil {
		return err
	}
	projection := projectPublicDaemonHealth(status)
	if *jsonOutput {
		out, err := json.MarshalIndent(projection, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
	} else {
		printCLIHeader(os.Stdout, "Nimi Runtime")
		printCLIField(os.Stdout, "mode", projection.Mode)
		printCLIField(os.Stdout, "process", projection.Process)
		if projection.PID > 0 {
			printCLIField(os.Stdout, "pid", fmt.Sprintf("%d", projection.PID))
		}
		if projection.Version != "" {
			printCLIField(os.Stdout, "version", projection.Version)
		}
		printCLIField(os.Stdout, "health", projection.Health)
		if projection.Health == publicDaemonHealthStopped {
			printCLINextStep(os.Stdout, "nimi start")
		}
	}
	if code := status.ExitCode(); code != 0 {
		return cliExitError{code: code}
	}
	return nil
}

func runRuntimeLogs(args []string) error {
	fs := flag.NewFlagSet("nimi logs", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	follow := fs.Bool("follow", false, "follow runtime logs (currently unavailable)")
	fs.BoolVar(follow, "f", false, "follow runtime logs (currently unavailable)")
	tailRaw := fs.String("tail", "200", "number of log lines (currently unavailable)")
	fs.StringVar(tailRaw, "n", "200", "number of log lines (currently unavailable)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	tail, err := strconv.Atoi(strings.TrimSpace(*tailRaw))
	if err != nil {
		return fmt.Errorf("parse tail: %w", err)
	}
	if tail <= 0 {
		return fmt.Errorf("parse tail: tail must be > 0")
	}
	return daemonManagerFactory().PrintLogs(context.Background(), os.Stdout, tail, *follow)
}
