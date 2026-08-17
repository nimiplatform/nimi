package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
)

const (
	publicDaemonHealthReachable      = "reachable"
	publicDaemonHealthUnreachable    = "unreachable"
	publicDaemonHealthServiceRunning = "service-running"
	publicDaemonHealthStopped        = "stopped"
)

type publicDaemonHealth struct {
	Mode      string `json:"mode"`
	Process   string `json:"process"`
	PID       int    `json:"pid,omitempty"`
	StartedAt string `json:"startedAt,omitempty"`
	Health    string `json:"health"`
	Version   string `json:"version,omitempty"`
}

// @nimi-authority: rule.nimi.runtime.service-operations.r086
func runRuntimeHealth(args []string) error {
	fs := flag.NewFlagSet("nimi health", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected health arguments: %s", strings.Join(fs.Args(), " "))
	}

	status, err := daemonManagerFactory().Status()
	if err != nil {
		return fmt.Errorf("determine Runtime daemon status: %w", err)
	}
	projection := projectPublicDaemonHealth(status)
	if *jsonOutput {
		output, marshalErr := json.MarshalIndent(projection, "", "  ")
		if marshalErr != nil {
			return marshalErr
		}
		fmt.Println(string(output))
	} else {
		printCLIHeader(os.Stdout, "Nimi Runtime Health")
		printCLIField(os.Stdout, "mode", projection.Mode)
		printCLIField(os.Stdout, "process", projection.Process)
		printCLIField(os.Stdout, "health", projection.Health)
		if projection.Version != "" {
			printCLIField(os.Stdout, "version", projection.Version)
		}
		if projection.Health == publicDaemonHealthStopped || projection.Health == publicDaemonHealthUnreachable {
			printCLINextStep(os.Stdout, "nimi start")
		}
	}
	if code := status.ExitCode(); code != 0 {
		return cliExitError{code: code}
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.service-operations.r082
func projectPublicDaemonHealth(status daemonctl.Status) publicDaemonHealth {
	projection := publicDaemonHealth{
		Mode:      status.Mode.String(),
		Process:   strings.TrimSpace(status.Process),
		PID:       status.PID,
		StartedAt: strings.TrimSpace(status.StartedAt),
		Version:   strings.TrimSpace(status.Version),
	}
	if projection.Mode == "" {
		projection.Mode = daemonctl.ModeStopped.String()
	}
	if projection.Process == "" {
		projection.Process = "stopped"
	}

	switch {
	case projection.Process != "running":
		projection.Health = publicDaemonHealthStopped
	case status.Mode == daemonctl.ModeProtectedService:
		projection.Health = publicDaemonHealthServiceRunning
	case status.HealthReachable:
		projection.Health = publicDaemonHealthReachable
	default:
		projection.Health = publicDaemonHealthUnreachable
	}
	return projection
}
