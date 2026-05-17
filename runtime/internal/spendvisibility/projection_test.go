package spendvisibility

import (
	"errors"
	"testing"
)

func TestProject_LocalRouteZeroCost(t *testing.T) {
	d, err := Project(ExecutionInput{
		CapabilityID: "text.generate",
		IsCloudRoute: false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !d.IsZeroCost() {
		t.Error("local route should report IsZeroCost")
	}
	if !d.EstimateAvailable {
		t.Error("zero-cost should have EstimateAvailable=true")
	}
}

func TestProject_CloudTextWithHint(t *testing.T) {
	d, err := Project(ExecutionInput{
		CapabilityID: "text.generate",
		IsCloudRoute: true,
		CostHint:     &CostHint{Currency: "USD", Amount: 0.002},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if d.Category != SpendCategoryCloudText {
		t.Errorf("category = %q, want cloud-text", d.Category)
	}
	if !d.EstimateAvailable {
		t.Error("hint provided; estimate should be available")
	}
	if d.EstimateCurrency != "USD" || d.EstimateAmount != 0.002 {
		t.Errorf("estimate = %s %.4f, want USD 0.0020", d.EstimateCurrency, d.EstimateAmount)
	}
}

func TestProject_CloudImageWithoutHintReturnsUnknownDisclosure(t *testing.T) {
	d, err := Project(ExecutionInput{
		CapabilityID: "image.generate",
		IsCloudRoute: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if d.Category != SpendCategoryCloudImage {
		t.Errorf("category = %q, want cloud-image", d.Category)
	}
	if d.EstimateAvailable {
		t.Error("no hint; estimate must NOT be available (fail-closed unknown)")
	}
	if d.Detail == "" {
		t.Error("unknown disclosure must carry detail explaining user-acceptance requirement")
	}
}

func TestProject_CloudVideoAndAudio(t *testing.T) {
	for capability, want := range map[string]SpendCategory{
		"video.generate":  SpendCategoryCloudVideo,
		"audio.synthesize": SpendCategoryCloudAudio,
	} {
		d, err := Project(ExecutionInput{
			CapabilityID: capability,
			IsCloudRoute: true,
		})
		if err != nil {
			t.Fatalf("%s: %v", capability, err)
		}
		if d.Category != want {
			t.Errorf("%s category = %q, want %q", capability, d.Category, want)
		}
	}
}

func TestProject_RejectsMissingCapabilityID(t *testing.T) {
	_, err := Project(ExecutionInput{})
	if err == nil {
		t.Fatal("missing capability_id should error")
	}
	if !errors.Is(err, ErrSpendInputRequired) {
		t.Errorf("error = %v, want ErrSpendInputRequired", err)
	}
}

func TestProject_RejectsUncategorizableCloudCapability(t *testing.T) {
	_, err := Project(ExecutionInput{
		CapabilityID: "world.generate",
		IsCloudRoute: true,
	})
	if err == nil {
		t.Fatal("uncategorizable cloud capability should error")
	}
	if !errors.Is(err, ErrSpendUnknownCategory) {
		t.Errorf("error = %v, want ErrSpendUnknownCategory", err)
	}
}

func TestSpendCategory_Valid(t *testing.T) {
	for _, c := range []SpendCategory{
		SpendCategoryCloudText, SpendCategoryCloudImage, SpendCategoryCloudVideo,
		SpendCategoryCloudAudio, SpendCategoryLocalZero,
	} {
		if !c.Valid() {
			t.Errorf("%q should be valid", c)
		}
	}
	if SpendCategory("rogue").Valid() {
		t.Error("rogue category must not be valid")
	}
}

func TestProject_NoUnsolicitedFabrication(t *testing.T) {
	// Sweep: cloud route without hint should NEVER set EstimateAvailable=true,
	// must never fabricate a number.
	for _, capability := range []string{"text.generate", "image.generate", "video.generate", "audio.synthesize"} {
		d, err := Project(ExecutionInput{
			CapabilityID: capability,
			IsCloudRoute: true,
		})
		if err != nil {
			t.Fatalf("%s: %v", capability, err)
		}
		if d.EstimateAvailable {
			t.Errorf("%s: estimate must NOT be available without CostHint", capability)
		}
		if d.EstimateAmount != 0 {
			t.Errorf("%s: amount must be 0 without hint, got %f", capability, d.EstimateAmount)
		}
		if d.EstimateCurrency != "" {
			t.Errorf("%s: currency must be empty without hint, got %q", capability, d.EstimateCurrency)
		}
	}
}
