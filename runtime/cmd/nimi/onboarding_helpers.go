package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
	"golang.org/x/term"
)

const (
	onboardingAppID         = "nimi.cli"
	onboardingSubjectUserID = "local-user"
)

func onboardingRunUsage() string {
	return `nimi run "What is Nimi?"`
}

func onboardingRuntimeUnavailableHint() string {
	return "Run 'nimi start' for background mode, or 'nimi serve' in another terminal."
}

var (
	onboardingInteractiveTerminal = func() bool {
		if os.Stdin == nil || os.Stdout == nil {
			return false
		}
		return term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
	}
	onboardingSecretPrompt = func(message string) (string, error) {
		if os.Stdin == nil || os.Stdout == nil {
			return "", fmt.Errorf("interactive terminal is required")
		}
		if _, err := fmt.Fprintf(os.Stdout, "%s ", strings.TrimSpace(message)); err != nil {
			return "", err
		}
		raw, err := term.ReadPassword(int(os.Stdin.Fd()))
		if _, writeErr := fmt.Fprintln(os.Stdout); writeErr != nil && err == nil {
			err = writeErr
		}
		if err != nil {
			return "", err
		}
		value := strings.TrimSpace(string(raw))
		if value == "" {
			return "", fmt.Errorf("api key is required")
		}
		return value, nil
	}
)

type onboardingRunTarget struct {
	Prompt           string
	ModelID          string
	RoutePolicy      runtimev1.RoutePolicy
	ProviderName     string
	ProviderEndpoint string
}

func routePolicyLabel(route runtimev1.RoutePolicy) string {
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		return "cloud"
	}
	return "local"
}

func isLocalOnboardingModel(modelID string) bool {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	return strings.HasPrefix(lower, "local/") || strings.HasPrefix(lower, "localai/") || strings.HasPrefix(lower, "nexa/")
}

func resolveProviderEndpoint(providerName string, target config.RuntimeFileTarget) string {
	return strings.TrimSpace(connector.ResolveEndpoint(providerName, strings.TrimSpace(target.BaseURL)))
}

func validateHighLevelLocalModel(modelID string) error {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return nil
	}
	if texttarget.IsHighLevelQualifiedModel(normalized) {
		return fmt.Errorf("--model expects a local model id only. Use `--model <local-model-id>`, `--provider <provider> --model <model>`, or the advanced `nimi ai text-generate --model-id ...` surface")
	}
	return nil
}

func validateHighLevelProviderModel(modelID string) error {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return nil
	}
	if strings.HasPrefix(strings.ToLower(normalized), "local/") || strings.HasPrefix(strings.ToLower(normalized), "cloud/") || texttarget.LooksLikeQualifiedRemoteModel(normalized) {
		return fmt.Errorf("--provider expects a provider-scoped model id. Use `--provider <provider> --model <model>`, not %q", normalized)
	}
	return nil
}

func resolveOnboardingRunTarget(cfg config.Config, prompt string, modelFlag string, providerFlag string, local bool, cloud bool) (onboardingRunTarget, error) {
	prompt = strings.TrimSpace(prompt)
	modelFlag = strings.TrimSpace(modelFlag)
	providerFlag = strings.TrimSpace(providerFlag)
	if prompt == "" {
		return onboardingRunTarget{}, fmt.Errorf("prompt is required. Usage: %s", onboardingRunUsage())
	}
	if local && cloud {
		return onboardingRunTarget{}, fmt.Errorf("choose one route: use either --local or --cloud, not both")
	}
	if local && providerFlag != "" {
		return onboardingRunTarget{}, fmt.Errorf("--provider cannot be combined with --local")
	}
	if cloud && providerFlag == "" && modelFlag != "" {
		return onboardingRunTarget{}, fmt.Errorf("--cloud --model is not supported. Use --provider <provider> --model <model>")
	}

	if providerFlag != "" {
		providerName, err := canonicalCloudProviderName(providerFlag)
		if err != nil {
			return onboardingRunTarget{}, err
		}
		target := cfg.Providers[providerName]
		modelID := providerName + "/default"
		if modelFlag != "" {
			if err := validateHighLevelProviderModel(modelFlag); err != nil {
				return onboardingRunTarget{}, err
			}
			modelID = providerName + "/" + modelFlag
		}
		return onboardingRunTarget{
			Prompt:           prompt,
			ModelID:          modelID,
			RoutePolicy:      runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			ProviderName:     providerName,
			ProviderEndpoint: resolveProviderEndpoint(providerName, target),
		}, nil
	}

	if cloud {
		providerName, target, err := texttarget.ResolveCloudProvider(cfg, "")
		if err != nil {
			return onboardingRunTarget{}, fmt.Errorf("default cloud target is not configured. Run 'nimi provider set <provider> --api-key ... --default'")
		}
		return onboardingRunTarget{
			Prompt:           prompt,
			ModelID:          "cloud/default",
			RoutePolicy:      runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			ProviderName:     providerName,
			ProviderEndpoint: resolveProviderEndpoint(providerName, target),
		}, nil
	}

	if modelFlag != "" {
		if err := validateHighLevelLocalModel(modelFlag); err != nil {
			return onboardingRunTarget{}, err
		}
		return onboardingRunTarget{
			Prompt:      prompt,
			ModelID:     texttarget.EnsureLocalQualifiedModel(modelFlag),
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		}, nil
	}

	defaultLocal := texttarget.ResolveLocalDefaultModel(cfg)
	return onboardingRunTarget{
		Prompt:      prompt,
		ModelID:     texttarget.EnsureLocalQualifiedModel(defaultLocal),
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	}, nil
}

func promptOnboardingAPIKey(providerName string) (string, error) {
	return onboardingSecretPrompt(fmt.Sprintf("%s API key is not configured. Paste it now:", strings.TrimSpace(providerName)))
}

func cloudCredentialSetupCommand(providerName string, setDefault bool) string {
	providerName = strings.TrimSpace(providerName)
	if providerName == "" {
		return "nimi provider set <provider> --api-key ..."
	}
	command := fmt.Sprintf("nimi provider set %s --api-key ...", providerName)
	if setDefault {
		command += " --default"
	}
	return command
}

func promptYesNo(reader io.Reader, writer io.Writer, message string, defaultYes bool) (bool, error) {
	suffix := "[y/N]"
	if defaultYes {
		suffix = "[Y/n]"
	}
	if _, err := fmt.Fprintf(writer, "%s %s ", strings.TrimSpace(message), suffix); err != nil {
		return false, err
	}
	line, err := bufio.NewReader(reader).ReadString('\n')
	if err != nil && err != io.EOF {
		return false, err
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	if answer == "" {
		return defaultYes, nil
	}
	switch answer {
	case "y", "yes":
		return true, nil
	case "n", "no":
		return false, nil
	default:
		return defaultYes, nil
	}
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func findSDKPackagePath(cwd string) string {
	if strings.TrimSpace(cwd) == "" {
		return ""
	}
	return filepath.Join(cwd, "node_modules", "@nimiplatform", "sdk", "package.json")
}
