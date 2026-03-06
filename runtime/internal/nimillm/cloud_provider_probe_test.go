package nimillm

import (
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestNormalizeTokenProviderIDCanonicalOnly(t *testing.T) {
	validCases := map[string]string{"": "nimillm"}
	for _, providerID := range providerregistry.RemoteProviders {
		validCases[providerID] = providerID
	}
	validCases["cloud-dashscope"] = "dashscope"
	validCases["cloud_openai_compatible"] = "openai_compatible"
	for raw, want := range validCases {
		got, err := NormalizeTokenProviderID(raw)
		if err != nil {
			t.Fatalf("NormalizeTokenProviderID(%q) returned error: %v", raw, err)
		}
		if got != want {
			t.Fatalf("NormalizeTokenProviderID(%q) mismatch: got=%q want=%q", raw, got, want)
		}
	}

	invalidCases := []string{
		"alibaba",
		"aliyun",
		"bytedance",
		"byte",
		"moonshot",
		"zhipu",
		"bigmodel",
		"cloudnimillm",
		"cloudbytedance",
		"cloudalibaba",
	}
	for _, raw := range invalidCases {
		_, err := NormalizeTokenProviderID(raw)
		if err == nil {
			t.Fatalf("NormalizeTokenProviderID(%q) should reject legacy alias", raw)
		}
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("NormalizeTokenProviderID(%q) error code mismatch: got=%v want=%v", raw, status.Code(err), codes.InvalidArgument)
		}
	}
}
