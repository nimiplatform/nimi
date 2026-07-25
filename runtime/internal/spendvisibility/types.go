// Package spendvisibility implements the typed AI spend visibility
// projection per `.nimi/spec/runtime/ai-provider.authority.yaml`.
//
// Per Wave 5 close-requires: "AI spend visibility appears before
// execution where policy requires it." This package projects typed
// pre-execution spend hints from existing usage metrics without
// fabricating estimates when policy data is absent.
package spendvisibility

import "errors"

// SpendCategory enumerates the canonical spend categories that the
// pre-execution projection may surface. The closed enum tracks
// canonical capability categories (cloud-text, cloud-image,
// cloud-video, cloud-audio, cloud-music, cloud-world,
// local-zero-cost — local execution carries no spend per existing
// usagemetrics semantics).
type SpendCategory string

const (
	SpendCategoryCloudText  SpendCategory = "cloud-text"
	SpendCategoryCloudImage SpendCategory = "cloud-image"
	SpendCategoryCloudVideo SpendCategory = "cloud-video"
	SpendCategoryCloudAudio SpendCategory = "cloud-audio"
	SpendCategoryCloudMusic SpendCategory = "cloud-music"
	SpendCategoryCloudWorld SpendCategory = "cloud-world"
	SpendCategoryLocalZero  SpendCategory = "local-zero-cost"
)

func (c SpendCategory) Valid() bool {
	switch c {
	case SpendCategoryCloudText, SpendCategoryCloudImage, SpendCategoryCloudVideo,
		SpendCategoryCloudAudio, SpendCategoryCloudMusic, SpendCategoryCloudWorld,
		SpendCategoryLocalZero:
		return true
	}
	return false
}

// SpendDisclosure carries the typed pre-execution spend information.
// Per policy: if EstimateAvailable is false, the surface MUST show an
// "unknown spend" state rather than guessing.
type SpendDisclosure struct {
	Category          SpendCategory
	EstimateAvailable bool
	EstimateCurrency  string
	EstimateAmount    float64
	BillingScope      string
	PolicyVersion     string
	Detail            string
}

// IsZeroCost reports whether the disclosure represents a no-spend
// path (local execution). Used by callers to skip the disclosure UI
// step entirely.
func (d SpendDisclosure) IsZeroCost() bool {
	return d.Category == SpendCategoryLocalZero
}

// Sentinel errors.
var (
	ErrSpendUnknownCategory = errors.New("spendvisibility unknown spend category")
	ErrSpendInputRequired   = errors.New("spendvisibility input is required")
)
