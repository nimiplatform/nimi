package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestInstallModelFromPlanCarriesPlanIdentityIntoTransfer(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	digest := sha256.Sum256(payload)
	digestHex := hex.EncodeToString(digest[:])
	revision := strings.Repeat("d", 40)
	const repo = "owner/repo"
	const filename = "encoder.gguf"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/owner/repo/resolve/"+revision+"/"+filename {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	descriptor := passiveCatalogDescriptorForTest("plan-transfer-correlation", runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, filename, digestHex, "qwen-vl", []string{"text_encoder"})
	descriptor.Repo = repo
	descriptor.Revision = revision
	descriptor.License = "test"
	svc.mu.Lock()
	svc.verified = append(svc.verified, descriptor)
	svc.mu.Unlock()

	plan, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{TemplateId: descriptor.GetTemplateId()})
	if err != nil {
		t.Fatalf("resolve install plan: %v", err)
	}
	planID := plan.GetPlan().GetPlanId()
	resp, err := svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{PlanId: planID})
	if err != nil {
		t.Fatalf("install from plan: %v", err)
	}
	if !strings.HasPrefix(resp.GetInstallSessionId(), "transfer_") {
		t.Fatalf("install session id = %q, want a transfer session identity", resp.GetInstallSessionId())
	}
	summary := svc.localTransferSummary(resp.GetInstallSessionId())
	if summary.GetPlanId() != planID || summary.GetState() != localTransferStateCompleted {
		t.Fatalf("transfer summary = plan:%q state:%q, want plan %q completed", summary.GetPlanId(), summary.GetState(), planID)
	}
	listed, err := svc.ListLocalTransfers(context.Background(), &runtimev1.ListLocalTransfersRequest{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, transfer := range listed.GetTransfers() {
		if transfer.GetInstallSessionId() == resp.GetInstallSessionId() {
			found = true
			if transfer.GetPlanId() != planID {
				t.Fatalf("listed transfer plan id = %q, want %q", transfer.GetPlanId(), planID)
			}
		}
	}
	if !found {
		t.Fatalf("install transfer %q missing from ListLocalTransfers", resp.GetInstallSessionId())
	}

	// The manual import path never gains a plan identity.
	source := filepath.Join(t.TempDir(), "imported.gguf")
	if err := os.WriteFile(source, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	imported, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: source, DisplayName: "manual import"})
	if err != nil {
		t.Fatalf("ImportModelAsset: %v", err)
	}
	if imported.GetTransfer().GetPlanId() != "" {
		t.Fatalf("import transfer carried a plan id: %q", imported.GetTransfer().GetPlanId())
	}
	// Import runs on a background executor; let it settle before temp cleanup.
	deadline := time.Now().Add(10 * time.Second)
	for !isTerminalTransferState(svc.localTransferSummary(imported.GetTransfer().GetInstallSessionId()).GetState()) {
		if time.Now().After(deadline) {
			t.Fatal("import transfer did not settle")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
