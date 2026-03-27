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
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

type providerListItem struct {
	Provider      string `json:"provider"`
	BaseURL       string `json:"baseUrl,omitempty"`
	DefaultModel  string `json:"defaultModel,omitempty"`
	DefaultSource string `json:"defaultSource,omitempty"`
	Credential    string `json:"credential"`
	Default       bool   `json:"default"`
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
	path := strings.TrimSpace(config.RuntimeConfigPath())
	if path == "" {
		return "", config.FileConfig{}, fmt.Errorf("runtime config path is empty")
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

func providerDefaultModelValue(providerName string, fileCfg config.FileConfig) (string, string) {
	target := fileCfg.Providers[providerName]
	if value := strings.TrimSpace(target.DefaultModel); value != "" {
		return value, "config"
	}
	if entry, ok := connector.ProviderCatalog[providerName]; ok && strings.TrimSpace(entry.DefaultTextModel) != "" {
		return strings.TrimSpace(entry.DefaultTextModel), "catalog"
	}
	return "", ""
}

func runRuntimeProviderList(args []string) error {
	fs := flag.NewFlagSet("nimi provider list", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args); err != nil {
		return err
	}

	path := strings.TrimSpace(config.RuntimeConfigPath())
	fileCfg, err := config.LoadFileConfig(path)
	if err != nil {
		return err
	}

	items := make([]providerListItem, 0, len(fileCfg.Providers))
	for providerName, target := range fileCfg.Providers {
		defaultModel, defaultSource := providerDefaultModelValue(providerName, fileCfg)
		items = append(items, providerListItem{
			Provider:      providerName,
			BaseURL:       strings.TrimSpace(target.BaseURL),
			DefaultModel:  defaultModel,
			DefaultSource: defaultSource,
			Credential:    providerCredentialKind(target),
			Default:       strings.TrimSpace(fileCfg.DefaultCloudProvider) == providerName,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Provider < items[j].Provider
	})

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"path":                 path,
			"defaultCloudProvider": strings.TrimSpace(fileCfg.DefaultCloudProvider),
			"providers":            items,
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
		printCLIField(os.Stdout, "default", "(none)")
		printCLIField(os.Stdout, "providers", "none")
		printCLINextStep(os.Stdout, `nimi run "What is Nimi?" --provider gemini`)
		return nil
	}
	printCLIHeader(os.Stdout, "Nimi Providers")
	printCLIField(os.Stdout, "config", path)
	defaultProvider := strings.TrimSpace(fileCfg.DefaultCloudProvider)
	if defaultProvider == "" {
		defaultProvider = "(none)"
	}
	printCLIField(os.Stdout, "default", defaultProvider)
	fmt.Println()
	for _, item := range items {
		fmt.Printf("  %s\n", item.Provider)
		credentialValue := item.Credential
		if item.Default {
			credentialValue = credentialValue + " (default)"
		}
		printCLIField(os.Stdout, "credential", credentialValue)
		printCLIField(os.Stdout, "model", item.DefaultModel)
		printCLIField(os.Stdout, "model source", item.DefaultSource)
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
	defaultModel := fs.String("default-model", "", "default model id")
	setDefault := fs.Bool("default", false, "set this provider as the default cloud provider")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(remainingArgs); err != nil {
		return err
	}
	if providerArg == "" && fs.NArg() > 0 {
		providerArg = fs.Arg(0)
	}
	if providerArg == "" {
		return fmt.Errorf("provider name is required. Usage: nimi provider set <provider> [--api-key ... | --api-key-env ...] [--default-model <model>] [--default]")
	}
	if strings.TrimSpace(*apiKey) != "" && strings.TrimSpace(*apiKeyEnv) != "" {
		return fmt.Errorf("choose one credential source: use either --api-key or --api-key-env")
	}

	providerName, err := canonicalCloudProviderName(providerArg)
	if err != nil {
		return err
	}
	if *setDefault && strings.TrimSpace(*defaultModel) == "" {
		if entry, ok := connector.ProviderCatalog[providerName]; !ok || strings.TrimSpace(entry.DefaultTextModel) == "" {
			return fmt.Errorf("provider %s has no catalog default text model. Use --default-model <model> together with --default", providerName)
		}
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
		if value := strings.TrimSpace(*defaultModel); value != "" {
			target.DefaultModel = value
		}
		fileCfg.Providers[providerName] = target
		if *setDefault {
			fileCfg.DefaultCloudProvider = providerName
		}
		return nil
	})
	if err != nil {
		return err
	}
	target := fileCfg.Providers[providerName]
	displayDefaultModel, defaultSource := providerDefaultModelValue(providerName, fileCfg)

	payload := map[string]any{
		"path":                   path,
		"provider":               providerName,
		"credential":             providerCredentialKind(target),
		"default_model":          displayDefaultModel,
		"default_model_source":   defaultSource,
		"base_url":               target.BaseURL,
		"default":                strings.TrimSpace(fileCfg.DefaultCloudProvider) == providerName,
		"default_cloud_provider": strings.TrimSpace(fileCfg.DefaultCloudProvider),
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
	printCLIField(os.Stdout, "model", displayDefaultModel)
	printCLIField(os.Stdout, "model source", defaultSource)
	printCLIField(os.Stdout, "base URL", target.BaseURL)
	if strings.TrimSpace(fileCfg.DefaultCloudProvider) == providerName {
		printCLIField(os.Stdout, "default", "yes")
	}
	printCLIField(os.Stdout, "config", path)
	if strings.TrimSpace(target.APIKey) != "" {
		printCLIField(os.Stdout, "warning", fmt.Sprintf("stored API key inline in %s. Prefer --api-key-env when possible.", path))
	}
	if strings.TrimSpace(fileCfg.DefaultCloudProvider) == providerName {
		printCLINextStep(os.Stdout, `nimi run "What is Nimi?" --cloud`)
		return nil
	}
	printCLINextStep(os.Stdout, fmt.Sprintf(`nimi run "What is Nimi?" --provider %s`, providerName))
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
	path, fileCfg, err := mutateProviderConfig(func(fileCfg *config.FileConfig) error {
		delete(fileCfg.Providers, providerName)
		if strings.TrimSpace(fileCfg.DefaultCloudProvider) == providerName {
			fileCfg.DefaultCloudProvider = ""
		}
		return nil
	})
	if err != nil {
		return err
	}

	payload := map[string]any{
		"path":                 path,
		"provider":             providerName,
		"removed":              true,
		"defaultCloudProvider": strings.TrimSpace(fileCfg.DefaultCloudProvider),
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
	if strings.TrimSpace(fileCfg.DefaultCloudProvider) == "" {
		printCLIField(os.Stdout, "default", "(none)")
	}
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
