package remoteexecution

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/ossmedia"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestOSSInputCleanupCannotRecreateAuthorityFromHistoricalJob(t *testing.T) {
	raw, _ := structpb.NewStruct(map[string]any{"provider": "dashscope", "providerModelId": "wan3.0-video", "remoteModelCatalogId": "catalog-wan"})
	_, target, err := capabilitydriver.NewProductionCloudMediaRegistry().Resolve(capabilitydriver.Identity{ImplementationID: "cloud.video.generate.dashscope", DriverID: "nimi.runtime.driver.dashscope", DriverDialect: "provider/media-v1"}, raw, "video.generate")
	if err != nil {
		t.Fatal(err)
	}
	ref, err := connector.CredentialCustodyRefForJob("old-job")
	if err != nil {
		t.Fatal(err)
	}
	captured := connector.ConnectorRecord{Provider: "dashscope", CredentialCustodyRef: ref, MediaStorage: &ossmedia.Config{Region: "cn-beijing", Bucket: "test-bucket", KeyPrefix: "nimi-input/"}}
	// No credential store or transport is bound. Historical capture alone must
	// be rejected before attempting either credential access or storage IO.
	host := NewProviderMediaHost(nil, nil, auditlog.New(16, 16), false)
	result := host.CleanupOwnedMedia(context.Background(), captured, target, []nimillm.CloudVideoMediaReference{{ContentIndex: 1, Reference: nimillm.CapturedMediaReference{MIMEType: "audio/wav", SHA256: strings.Repeat("a", 64)}}}, MediaDispatchAudit{AppID: "app", AccountID: "account", TraceID: "cleanup-test", Provider: "dashscope", CapabilityContract: "video.generate"})
	if result.State != "unconfirmed" || result.Unconfirmed != 1 || result.ReasonCode != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN {
		t.Fatal(result)
	}
}
