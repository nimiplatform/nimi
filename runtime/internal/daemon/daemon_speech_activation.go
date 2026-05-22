package daemon

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

type localEnvironmentSelectedSourceLister interface {
	ListLocalEnvironmentSelectedSources(context.Context, *runtimev1.ListLocalEnvironmentSelectedSourcesRequest) (*runtimev1.ListLocalEnvironmentSelectedSourcesResponse, error)
}

func (d *Daemon) configureSpeechActivation(ctx context.Context, lister localEnvironmentSelectedSourceLister) error {
	if d.engineMgr == nil {
		return fmt.Errorf("speech activation requires engine manager")
	}
	if lister == nil {
		return fmt.Errorf("speech activation requires local environment selected-source lister")
	}
	modelsRoot := strings.TrimSpace(d.cfg.LocalModelsPath)
	if modelsRoot == "" {
		return fmt.Errorf("speech activation requires managed local models root")
	}
	ttsRoot, err := speechPackageSetRootForConsumer(ctx, lister, "speech.qwen3-tts.python", "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", engine.SpeechQwen3TTSDriverPath)
	if err != nil {
		return err
	}
	asrRoot, err := speechPackageSetRootForConsumer(ctx, lister, "speech.qwen3-asr.python", "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", engine.SpeechQwen3ASRDriverPath)
	if err != nil {
		return err
	}
	d.engineMgr.SetSpeechPaths(modelsRoot, ttsRoot, asrRoot)
	return nil
}

func speechPackageSetRootForConsumer(ctx context.Context, lister localEnvironmentSelectedSourceLister, consumer string, envKey string, driverPath func(string) string) (string, error) {
	resp, err := lister.ListLocalEnvironmentSelectedSources(ctx, &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: "python.package-set",
		ConsumerScope:    consumer,
	})
	if err != nil {
		return "", fmt.Errorf("list speech package-set selected source for %s: %w", consumer, err)
	}
	var selected *runtimev1.LocalEnvironmentSelectedSourceRecord
	var lastDetail string
	for _, source := range resp.GetSources() {
		if speechSelectedSourceRepairActive(source.GetRepairState()) {
			lastDetail = "selected source is under repair"
			continue
		}
		if !stringSliceContains(source.GetSelectedConsumers(), consumer) {
			continue
		}
		root := strings.TrimSpace(source.GetCanonicalRoot())
		if root == "" {
			lastDetail = "selected source missing canonical root"
			continue
		}
		driverScript := strings.TrimSpace(driverPath(root))
		if !stringSliceContains(source.GetVerifiedArtifacts(), driverScript) {
			lastDetail = fmt.Sprintf("selected source missing verified driver script %s", driverScript)
			continue
		}
		if !activationEnvDeltaContainsKey(source.GetActivationEnvDelta(), envKey) {
			lastDetail = fmt.Sprintf("selected source missing verified driver command %s", envKey)
			continue
		}
		selected = source
		break
	}
	if selected == nil {
		if strings.TrimSpace(lastDetail) == "" {
			lastDetail = "no selected source record for consumer"
		}
		return "", fmt.Errorf("speech package-set selected source missing for %s: %s", consumer, lastDetail)
	}
	root := strings.TrimSpace(selected.GetCanonicalRoot())
	return root, nil
}

func speechSelectedSourceRepairActive(repairState string) bool {
	switch strings.TrimSpace(repairState) {
	case "", "none":
		return false
	case "repair_required", "repair_running", "repair_failed":
		return true
	default:
		return true
	}
}

func activationEnvDeltaContainsKey(values []string, key string) bool {
	prefix := strings.TrimSpace(key) + "="
	for _, value := range values {
		if strings.HasPrefix(strings.TrimSpace(value), prefix) && strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), prefix)) != "" {
			return true
		}
	}
	return false
}

func stringSliceContains(values []string, target string) bool {
	trimmedTarget := strings.TrimSpace(target)
	for _, value := range values {
		if strings.TrimSpace(value) == trimmedTarget {
			return true
		}
	}
	return false
}
