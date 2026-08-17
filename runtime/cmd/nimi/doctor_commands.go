package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

type doctorItem struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func runRuntimeDoctor(args []string) error {
	fs := flag.NewFlagSet("nimi doctor", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	configPath := strings.TrimSpace(config.RuntimeConfigPath())
	nextStep := ""
	items := []doctorItem{
		{Name: "runtime binary", Value: Version, Status: "ok"},
	}

	if configPath != "" {
		if fileExists(configPath) {
			items = append(items, doctorItem{Name: "non-production portable config", Value: configPath, Status: "ok"})
		} else {
			items = append(items, doctorItem{Name: "non-production portable config", Value: configPath, Status: "warn", Detail: "missing"})
		}
	}

	runtimeStatus, statusErr := daemonManagerFactory().Status()
	if statusErr != nil {
		return fmt.Errorf("determine Runtime daemon status: %w", statusErr)
	}
	publicHealth := projectPublicDaemonHealth(runtimeStatus)
	itemStatus := "ok"
	detail := publicHealth.Health
	switch publicHealth.Health {
	case publicDaemonHealthStopped:
		itemStatus = "warn"
		nextStep = "nimi start"
	case publicDaemonHealthUnreachable:
		itemStatus = "warn"
		nextStep = "nimi logs -f"
	}
	items = append(items, doctorItem{Name: "daemon", Value: publicHealth.Process, Status: itemStatus, Detail: detail})

	if runtimeStatus.Process == "running" {
		items = append(items, doctorItem{
			Name:   "runtime mode",
			Value:  runtimeStatus.Mode.String(),
			Status: "ok",
		})
	}

	cwd, _ := os.Getwd()
	if sdkPath := findSDKPackagePath(cwd); fileExists(sdkPath) {
		items = append(items, doctorItem{
			Name:   "sdk",
			Value:  "@nimiplatform/sdk",
			Status: "ok",
			Detail: fmt.Sprintf("found in %s", filepath.Dir(sdkPath)),
		})
	}

	if *jsonOutput {
		payload := map[string]any{
			"items": items,
		}
		if nextStep != "" {
			payload["nextStep"] = nextStep
		}
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		if code := runtimeStatus.ExitCode(); code != 0 {
			return cliExitError{code: code}
		}
		return nil
	}

	printCLIHeader(os.Stdout, "Nimi Doctor")
	for _, item := range items {
		value := strings.TrimSpace(item.Value)
		if status := inlineStatusLabel(item.Status); status != "" {
			value = strings.TrimSpace(value + "  " + status)
		}
		detail := strings.TrimSpace(item.Detail)
		if detail != "" {
			value = strings.TrimSpace(value + "  " + detail)
		}
		printCLIField(os.Stdout, item.Name, value)
	}
	if nextStep != "" {
		printCLINextStep(os.Stdout, nextStep)
	}
	if code := runtimeStatus.ExitCode(); code != 0 {
		return cliExitError{code: code}
	}
	return nil
}
