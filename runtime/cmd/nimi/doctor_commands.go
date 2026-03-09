package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
)

type doctorItem struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

var doctorStatusProvider = func() (daemonctl.Status, error) {
	return daemonctl.NewManager(Version).Status()
}

func runRuntimeDoctor(args []string) error {
	fs := flag.NewFlagSet("nimi doctor", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	defaultCfg := config.DefaultFileConfig()
	configPath := strings.TrimSpace(config.RuntimeConfigPath())
	grpcAddr := strings.TrimSpace(defaultCfg.GRPCAddr)
	nextStep := ""
	items := []doctorItem{
		{Name: "runtime binary", Value: Version, Status: "ok"},
	}

	if configPath == "" {
		items = append(items, doctorItem{Name: "config file", Value: "(unresolved)", Status: "warn", Detail: "set HOME or NIMI_RUNTIME_CONFIG_PATH"})
	} else if fileExists(configPath) {
		items = append(items, doctorItem{Name: "config file", Value: configPath, Status: "ok"})
	} else {
		items = append(items, doctorItem{Name: "config file", Value: configPath, Status: "warn", Detail: "missing"})
	}

	cfg, cfgErr := config.Load()
	if cfgErr == nil {
		grpcAddr = cfg.GRPCAddr
	}

	var providers []entrypoint.ProviderHealthSnapshot
	if cfgErr != nil {
		items = append(items, doctorItem{Name: "runtime config", Value: "load", Status: "warn", Detail: cfgErr.Error()})
	}

	healthPayload, healthErr := entrypoint.FetchRuntimeHealthGRPC(grpcAddr, 3*time.Second)
	if healthErr != nil {
		items = append(items, doctorItem{Name: "gRPC daemon", Value: grpcAddr, Status: "warn", Detail: "Run 'nimi start' for background mode, or 'nimi serve' in another terminal."})
		nextStep = "nimi start"
	} else {
		status := strings.TrimSpace(fmt.Sprint(healthPayload["status"]))
		if status == "" {
			status = "healthy"
		}
		items = append(items, doctorItem{Name: "gRPC daemon", Value: grpcAddr, Status: "ok", Detail: status})

		if providerSnapshots, err := entrypoint.FetchAIProviderHealthGRPC(grpcAddr, 3*time.Second); err == nil {
			providers = providerSnapshots
			localState := "unknown"
			localDetail := ""
			for _, item := range providerSnapshots {
				if strings.TrimSpace(item.Name) != "local" {
					continue
				}
				localState = item.State
				localDetail = item.Reason
				break
			}
			localStatus := "warn"
			if localState == "healthy" || localState == "ok" || localState == "active" {
				localStatus = "ok"
			}
			items = append(items, doctorItem{Name: "local engine", Value: "local", Status: localStatus, Detail: strings.TrimSpace(localState + " " + localDetail)})
		}

		if modelsResp, err := entrypoint.ListModelsGRPC(grpcAddr, 3*time.Second, onboardingAppID); err == nil {
			installed := len(modelsResp.GetModels())
			ready := 0
			for _, model := range modelsResp.GetModels() {
				if model.GetStatus() == runtimev1.ModelStatus_MODEL_STATUS_INSTALLED {
					ready += 1
				}
			}
			items = append(items, doctorItem{
				Name:   "models",
				Value:  fmt.Sprintf("%d installed (%d ready)", installed, ready),
				Status: "ok",
			})
		}
	}

	if runtimeStatus, err := doctorStatusProvider(); err == nil && runtimeStatus.Process == "running" {
		items = append(items, doctorItem{
			Name:   "runtime mode",
			Value:  runtimeStatus.Mode,
			Status: "ok",
		})
	}

	if cfgErr == nil {
		configuredProviders := make([]string, 0, len(cfg.Providers))
		for providerName, target := range cfg.Providers {
			configuredProviders = append(configuredProviders, providerName)
			status := "warn"
			detail := "no api key"
			if key := strings.TrimSpace(config.ResolveProviderAPIKey(target)); key != "" {
				status = "ok"
				detail = "configured"
			}
			items = append(items, doctorItem{
				Name:   "cloud provider",
				Value:  providerName,
				Status: status,
				Detail: detail,
			})
		}
		sort.Strings(configuredProviders)
		if len(configuredProviders) == 0 && len(providers) == 0 {
			items = append(items, doctorItem{
				Name:   "cloud provider",
				Value:  "none",
				Status: "warn",
				Detail: "Try 'nimi run \"Hello from Nimi\" --provider gemini'",
			})
			if nextStep == "" {
				nextStep = `nimi run "Hello from Nimi" --provider gemini`
			}
		}
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
		out, err := json.MarshalIndent(map[string]any{
			"items": items,
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
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
	return nil
}
