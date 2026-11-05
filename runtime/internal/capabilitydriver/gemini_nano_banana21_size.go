package capabilitydriver

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.nano-banana21-image-size
// imageSize is a native resolution tier, not an exact pixel geometry. The
// provider's published size table does not match every actual generated image.
func GeminiNanoBanana21ImageSize(spec *runtimev1.ImageGenerateScenarioSpec) (string, error) {
	size := strings.ToUpper(strings.TrimSpace(spec.GetSize()))
	switch size {
	case "":
		return "", nil
	case "1K", "2K", "4K":
		return size, nil
	}
	return "", fmt.Errorf("Nano Banana 2.1 size must be a native 1K, 2K or 4K resolution tier")
}
