package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
)

type daemonManager interface {
	Start(timeout time.Duration) (daemonctl.StartResult, error)
	Stop(timeout time.Duration, force bool) (daemonctl.StopResult, error)
	Status() (daemonctl.Status, error)
	PrintLogs(w io.Writer, tail int, follow bool) error
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
	fs.SetOutput(os.Stdout)
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
	printCLIField(os.Stdout, "mode", result.Mode)
	printCLIField(os.Stdout, "pid", fmt.Sprintf("%d", result.PID))
	printCLIField(os.Stdout, "grpc", result.GRPCAddr)
	printCLIField(os.Stdout, "config", result.ConfigPath)
	printCLIField(os.Stdout, "logs", result.LogPath)
	if strings.TrimSpace(result.Version) != "" {
		printCLIField(os.Stdout, "version", result.Version)
	}
	if strings.TrimSpace(result.HealthSummary) != "" {
		printCLIField(os.Stdout, "health", result.HealthSummary)
	}
	if strings.TrimSpace(result.Warning) != "" {
		printCLIField(os.Stdout, "warning", result.Warning)
	}
	return nil
}

func runRuntimeStop(args []string) error {
	fs := flag.NewFlagSet("nimi stop", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	timeoutRaw := fs.String("timeout", "10s", "shutdown timeout")
	force := fs.Bool("force", false, "force kill the runtime process")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	result, err := daemonManagerFactory().Stop(timeout, *force)
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
	if strings.TrimSpace(result.Mode) != "" {
		printCLIField(os.Stdout, "mode", result.Mode)
	}
	return nil
}

func runRuntimeStatus(args []string) error {
	fs := flag.NewFlagSet("nimi status", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	status, err := daemonManagerFactory().Status()
	if err != nil {
		return err
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(status, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
	} else {
		printCLIHeader(os.Stdout, "Nimi Runtime")
		printCLIField(os.Stdout, "mode", status.Mode)
		printCLIField(os.Stdout, "process", status.Process)
		if status.PID > 0 {
			printCLIField(os.Stdout, "pid", fmt.Sprintf("%d", status.PID))
		}
		if strings.TrimSpace(status.GRPCAddr) != "" {
			printCLIField(os.Stdout, "grpc", status.GRPCAddr)
		}
		if strings.TrimSpace(status.ConfigPath) != "" {
			printCLIField(os.Stdout, "config", status.ConfigPath)
		}
		if strings.TrimSpace(status.LogPath) != "" {
			printCLIField(os.Stdout, "logs", status.LogPath)
		}
		if strings.TrimSpace(status.StartedAt) != "" {
			printCLIField(os.Stdout, "started", status.StartedAt)
		}
		if strings.TrimSpace(status.Version) != "" {
			printCLIField(os.Stdout, "version", status.Version)
		}
		if strings.TrimSpace(status.HealthSummary) != "" {
			printCLIField(os.Stdout, "health", status.HealthSummary)
		}
		if strings.TrimSpace(status.HealthError) != "" {
			printCLIField(os.Stdout, "detail", status.HealthError)
		}
		switch {
		case status.Process != "running":
			printCLINextStep(os.Stdout, "nimi start")
		case !status.HealthReachable && strings.TrimSpace(status.LogPath) != "":
			printCLINextStep(os.Stdout, "nimi logs -f")
		}
	}
	if code := status.ExitCode(); code != 0 {
		return cliExitError{code: code}
	}
	return nil
}

func runRuntimeLogs(args []string) error {
	fs := flag.NewFlagSet("nimi logs", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	follow := fs.Bool("follow", false, "follow runtime logs")
	fs.BoolVar(follow, "f", false, "follow runtime logs")
	tailRaw := fs.String("tail", "200", "number of lines to show")
	fs.StringVar(tailRaw, "n", "200", "number of lines to show")
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
	return daemonManagerFactory().PrintLogs(os.Stdout, tail, *follow)
}
