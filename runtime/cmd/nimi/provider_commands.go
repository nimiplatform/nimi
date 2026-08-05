package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
)

type providerListItem struct {
	Provider   string `json:"provider"`
	BaseURL    string `json:"baseUrl,omitempty"`
	Credential string `json:"credential"`
}

func splitLeadingPositionalArg(args []string) (string, []string) {
	if len(args) == 0 {
		return "", args
	}
	first := strings.TrimSpace(args[0])
	if first == "" || strings.HasPrefix(first, "-") {
		return "", args
	}
	return first, args[1:]
}

func canonicalCloudProviderName(raw string) (string, error) {
	normalized := config.NormalizeProviderName(raw)
	canonical, ok := config.ResolveCanonicalProviderID(normalized)
	if !ok {
		return "", fmt.Errorf("unsupported cloud provider %q. Use a canonical provider name such as openai, gemini, anthropic, or deepseek", raw)
	}
	return canonical, nil
}

func providerCredentialKind(target config.RuntimeFileTarget) string {
	if strings.TrimSpace(target.APIKeyEnv) != "" {
		return "env"
	}
	if strings.TrimSpace(target.APIKey) != "" {
		return "inline"
	}
	return "missing"
}

func mutateProviderConfig(mutator func(*config.FileConfig) error) (string, config.FileConfig, error) {
	path, pathErr := config.PortableRuntimeConfigPath()
	path = strings.TrimSpace(path)
	if pathErr != nil {
		return "", config.FileConfig{}, pathErr
	}
	if path == "" {
		return "", config.FileConfig{}, fmt.Errorf("portable Runtime config is unavailable; set NIMI_RUNTIME_CONFIG_PATH to an explicit non-production path")
	}
	unlock, err := acquireConfigWriteLock(path)
	if err != nil {
		return "", config.FileConfig{}, err
	}
	defer unlock()

	fileCfg, err := loadConfigForMutation(path)
	if err != nil {
		return "", config.FileConfig{}, err
	}
	if fileCfg.Providers == nil {
		fileCfg.Providers = map[string]config.RuntimeFileTarget{}
	}
	if err := mutator(&fileCfg); err != nil {
		return "", config.FileConfig{}, err
	}
	if err := config.WriteFileConfig(path, fileCfg); err != nil {
		return "", config.FileConfig{}, err
	}
	return path, fileCfg, nil
}

func runRuntimeProviderList(args []string) error {
	fs := flag.NewFlagSet("nimi provider list", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	path, pathErr := config.PortableRuntimeConfigPath()
	path = strings.TrimSpace(path)
	if pathErr != nil {
		return pathErr
	}
	if path == "" {
		return fmt.Errorf("portable Runtime config is unavailable; set NIMI_RUNTIME_CONFIG_PATH to an explicit non-production path")
	}
	fileCfg, err := config.LoadFileConfig(path)
	if err != nil {
		return err
	}
	if err := config.RejectProductControlOwnedFileConfigFields(fileCfg); err != nil {
		return newConfigCommandError(configReasonSchemaInvalid, "repair dataRoot.path through Product Control", err)
	}

	items := make([]providerListItem, 0, len(fileCfg.Providers))
	for providerName, target := range fileCfg.Providers {
		items = append(items, providerListItem{
			Provider:   providerName,
			BaseURL:    strings.TrimSpace(target.BaseURL),
			Credential: providerCredentialKind(target),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Provider < items[j].Provider
	})

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"path":      path,
			"providers": items,
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	if len(items) == 0 {
		printCLIHeader(os.Stdout, "Nimi Providers")
		printCLIField(os.Stdout, "config", path)
		printCLIField(os.Stdout, "providers", "none")
		printCLINextStep(os.Stdout, `configure caller-owned AIConfig, then run: nimi run "What is Nimi?"`)
		return nil
	}
	printCLIHeader(os.Stdout, "Nimi Providers")
	printCLIField(os.Stdout, "config", path)
	fmt.Println()
	for _, item := range items {
		fmt.Printf("  %s\n", item.Provider)
		printCLIField(os.Stdout, "credential", item.Credential)
		printCLIField(os.Stdout, "base URL", item.BaseURL)
		fmt.Println()
	}
	return nil
}

func runRuntimeProviderSet(args []string) error {
	providerArg, remainingArgs := splitLeadingPositionalArg(args)

	fs := flag.NewFlagSet("nimi provider set", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	apiKey := fs.String("api-key", "", "provider api key")
	apiKeyEnv := fs.String("api-key-env", "", "provider api key env var name")
	baseURL := fs.String("base-url", "", "provider base url")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(remainingArgs); err != nil {
		return err
	}
	if providerArg == "" && fs.NArg() > 0 {
		providerArg = fs.Arg(0)
	}
	if providerArg == "" {
		return fmt.Errorf("provider name is required. Usage: nimi provider set <provider> [--api-key ... | --api-key-env ...] [--base-url ...]")
	}
	if strings.TrimSpace(*apiKey) != "" && strings.TrimSpace(*apiKeyEnv) != "" {
		return fmt.Errorf("choose one credential source: use either --api-key or --api-key-env")
	}

	providerName, err := canonicalCloudProviderName(providerArg)
	if err != nil {
		return err
	}
	path, fileCfg, err := mutateProviderConfig(func(fileCfg *config.FileConfig) error {
		target := fileCfg.Providers[providerName]
		if value := strings.TrimSpace(*apiKey); value != "" {
			target.APIKey = value
			target.APIKeyEnv = ""
		}
		if value := strings.TrimSpace(*apiKeyEnv); value != "" {
			target.APIKeyEnv = value
			target.APIKey = ""
		}
		if value := strings.TrimSpace(*baseURL); value != "" {
			target.BaseURL = value
		}
		fileCfg.Providers[providerName] = target
		return nil
	})
	if err != nil {
		return err
	}
	target := fileCfg.Providers[providerName]
	payload := map[string]any{
		"path":       path,
		"provider":   providerName,
		"credential": providerCredentialKind(target),
		"base_url":   target.BaseURL,
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	printCLIHeader(os.Stdout, "Configured Provider")
	printCLIField(os.Stdout, "provider", providerName)
	printCLIField(os.Stdout, "credential", providerCredentialKind(target))
	printCLIField(os.Stdout, "base URL", target.BaseURL)
	printCLIField(os.Stdout, "config", path)
	if strings.TrimSpace(target.APIKey) != "" {
		printCLIField(os.Stdout, "warning", fmt.Sprintf("stored API key inline in %s. Prefer --api-key-env when possible.", path))
	}
	printCLINextStep(os.Stdout, `configure caller-owned AIConfig, then run: nimi run "What is Nimi?"`)
	return nil
}

func runRuntimeProviderUnset(args []string) error {
	providerArg, remainingArgs := splitLeadingPositionalArg(args)

	fs := flag.NewFlagSet("nimi provider unset", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(remainingArgs); err != nil {
		return err
	}
	if providerArg == "" && fs.NArg() > 0 {
		providerArg = fs.Arg(0)
	}
	if providerArg == "" {
		return fmt.Errorf("provider name is required. Usage: nimi provider unset <provider>")
	}

	providerName, err := canonicalCloudProviderName(providerArg)
	if err != nil {
		return err
	}
	path, _, err := mutateProviderConfig(func(fileCfg *config.FileConfig) error {
		delete(fileCfg.Providers, providerName)
		return nil
	})
	if err != nil {
		return err
	}

	payload := map[string]any{
		"path":     path,
		"provider": providerName,
		"removed":  true,
	}
	if *jsonOutput {
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	printCLIHeader(os.Stdout, "Removed Provider")
	printCLIField(os.Stdout, "provider", providerName)
	printCLIField(os.Stdout, "config", path)
	return nil
}

func runRuntimeProviderTest(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	providerArg, remainingArgs := splitLeadingPositionalArg(args)

	fs := flag.NewFlagSet("nimi provider test", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "request timeout")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(remainingArgs); err != nil {
		return err
	}
	if providerArg == "" && fs.NArg() > 0 {
		providerArg = fs.Arg(0)
	}
	if providerArg == "" {
		return fmt.Errorf("provider name is required. Usage: nimi provider test <provider>")
	}

	providerName, err := canonicalCloudProviderName(providerArg)
	if err != nil {
		return err
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}

	items, err := entrypoint.FetchAIProviderHealthGRPC(*grpcAddr, timeout)
	if err != nil {
		return fmt.Errorf("runtime unavailable. %s", onboardingRuntimeUnavailableHint())
	}

	for _, item := range items {
		if strings.TrimSpace(item.Name) != providerName {
			continue
		}
		payload := map[string]any{
			"provider":      providerName,
			"state":         item.State,
			"reason":        item.Reason,
			"last_checked":  item.LastCheckedAt,
			"last_changed":  item.LastChangedAt,
			"failure_count": item.ConsecutiveFailures,
		}
		if *jsonOutput {
			out, marshalErr := json.MarshalIndent(payload, "", "  ")
			if marshalErr != nil {
				return marshalErr
			}
			fmt.Println(string(out))
			return nil
		}
		printCLIHeader(os.Stdout, "Provider Health")
		printCLIField(os.Stdout, "provider", providerName)
		printCLIField(os.Stdout, "state", item.State)
		printCLIField(os.Stdout, "reason", item.Reason)
		printCLIField(os.Stdout, "last checked", item.LastCheckedAt)
		printCLIField(os.Stdout, "last changed", item.LastChangedAt)
		printCLIField(os.Stdout, "failures", fmt.Sprintf("%d", item.ConsecutiveFailures))
		if !providerStateLooksHealthy(item.State) {
			printCLINextStep(os.Stdout, "nimi doctor")
		}
		return nil
	}

	return fmt.Errorf("provider %s not found in runtime health snapshots", providerName)
}
