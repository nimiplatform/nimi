package localservice

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
)

type productControlFirstRunConsumerBinding struct {
	ConsumerID string
	AssetID    string
}

var productControlFirstRunConsumerSlotByID = map[string]string{
	"llama.cpp.cpu":           "chat",
	"speech.qwen3-asr.python": "stt",
	"speech.qwen3-tts.python": "tts",
}

func productControlFirstRunConsumerSet(installLevel string) ([]string, bool) {
	switch installLevel {
	case localEnvironmentInstallLevelMinimal, localEnvironmentInstallLevelRecommended:
		return []string{
			"llama.cpp.cpu",
			"speech.qwen3-asr.python",
			"speech.qwen3-tts.python",
		}, true
	default:
		return nil, false
	}
}

func (s *Service) resolveProductControlFirstRunConsumerBindings(
	installLevel string,
	hostProfile *runtimev1.LocalDeviceProfile,
	consumerIDs []string,
) ([]productControlFirstRunConsumerBinding, error) {
	if s.localProviderCatalog == nil {
		return nil, fmt.Errorf("local provider catalog is not loaded")
	}
	outcome := s.localProviderCatalog.ResolveLocalModelSet(installLevel, hostProfile)
	switch outcome.Kind {
	case catalog.LocalResolveFailClose:
		reason := strings.TrimSpace(outcome.ReasonCode)
		detail := strings.TrimSpace(outcome.Detail)
		if detail == "" {
			detail = "local model set resolution failed closed"
		}
		if reason != "" {
			detail += " (" + reason + ")"
		}
		return nil, fmt.Errorf("%s", detail)
	case catalog.LocalResolveResolved:
	default:
		return nil, fmt.Errorf("local model set resolution returned an unknown outcome")
	}

	bindings := make([]productControlFirstRunConsumerBinding, 0, len(consumerIDs))
	for _, consumerID := range consumerIDs {
		slotID, ok := productControlFirstRunConsumerSlotByID[consumerID]
		if !ok {
			return nil, fmt.Errorf("first-run consumer has no curated resolver slot: %s", consumerID)
		}
		resolvedSlot, ok := outcome.ResolvedSlotByName(slotID)
		if !ok {
			return nil, fmt.Errorf(
				"first-run consumer %q slot %q was not resolved to a model asset",
				consumerID,
				slotID,
			)
		}
		bindings = append(bindings, productControlFirstRunConsumerBinding{
			ConsumerID: consumerID,
			AssetID:    resolvedSlot.AssetID,
		})
	}
	return bindings, nil
}
