package connector

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

func testOSSUpdate(bucket string) *runtimev1.ConnectorMediaStorageUpdate {
	return &runtimev1.ConnectorMediaStorageUpdate{Change: &runtimev1.ConnectorMediaStorageUpdate_Oss{Oss: &runtimev1.ConnectorOSSStorageInput{
		Config: &runtimev1.ConnectorOSSStorage{Region: "cn-beijing", Bucket: bucket, KeyPrefix: "nimi-input/"}, AccessKeyId: "test-access-key-id", AccessKeySecret: "test-storage-secret",
	}}}
}

func TestOSSConnectorCapturePreservesOriginalStorageAndProviderCredential(t *testing.T) {
	s := newTestService(t)
	ctx := userContext("user-1")
	created, err := s.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "dashscope", ApiKey: "provider-key-1", MediaStorage: testOSSUpdate("test-original")})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Connector.ConnectorId
	if created.Connector.GetMediaStorage().GetBucket() != "test-original" {
		t.Fatal("missing nonsecret storage projection")
	}
	raw, _ := json.Marshal(created.Connector)
	if strings.Contains(string(raw), "test-storage-secret") || strings.Contains(string(raw), "test-access-key-id") {
		t.Fatal("credentials escaped projection")
	}
	registry, err := os.ReadFile(s.store.registryPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(registry), "test-storage-secret") {
		t.Fatal("storage secret escaped protected custody")
	}
	captured, ref, err := s.store.CaptureCredentialCustody(id, "oss-original-job")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, ApiKey: proto.String("provider-key-2")}); err != nil {
		t.Fatal(err)
	}
	current, _, _ := s.store.Get(id)
	payload, _ := s.store.LoadSecretPayload(id)
	resolved := ResolveCredential(current, payload)
	if resolved.APIKey != "provider-key-2" || resolved.MediaStorage == nil || resolved.MediaStorage.Config.Bucket != "test-original" {
		t.Fatal("provider key update lost OSS custody")
	}
	if _, err = s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, MediaStorage: testOSSUpdate("test-replacement")}); err != nil {
		t.Fatal(err)
	}
	clear := &runtimev1.ConnectorMediaStorageUpdate{Change: &runtimev1.ConnectorMediaStorageUpdate_Remove{Remove: true}}
	removed, err := s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, MediaStorage: clear})
	if err != nil {
		t.Fatal(err)
	}
	if removed.Connector.MediaStorage != nil {
		t.Fatal("storage not explicitly removed")
	}
	current, _, _ = s.store.Get(id)
	payload, _ = s.store.LoadSecretPayload(id)
	resolved = ResolveCredential(current, payload)
	if resolved.APIKey != "provider-key-2" || resolved.MediaStorage != nil {
		t.Fatal("removal changed provider key or retained storage")
	}
	original, err := s.store.LoadCredentialCustody(ref)
	if err != nil {
		t.Fatal(err)
	}
	old := ResolveCredential(captured, original)
	if old.APIKey != "provider-key-1" || old.MediaStorage == nil || old.MediaStorage.Config.Bucket != "test-original" {
		t.Fatal("retargeted captured job credential")
	}
	bad := captured
	config := *bad.MediaStorage
	config.Bucket = "another-bucket"
	bad.MediaStorage = &config
	if ResolveCredential(bad, original).APIKey != "" {
		t.Fatal("mismatched config and sealed credential accepted")
	}
}

func TestOSSConnectorManagementRejectsUnknownOrUnownedConfiguration(t *testing.T) {
	s := newTestService(t)
	ctx := userContext("owner")
	for _, provider := range []string{"openai", "gemini"} {
		if _, err := s.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: provider, ApiKey: "provider-key", MediaStorage: testOSSUpdate("test-bucket")}); err == nil {
			t.Fatal("unsupported provider storage admitted")
		}
	}
	for _, bucket := range []string{"ab", "Uppercase", "a/bucket", "bucket.example.com"} {
		if _, err := s.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "dashscope", ApiKey: "provider-key", MediaStorage: testOSSUpdate(bucket)}); err == nil {
			t.Fatal("invalid bucket admitted")
		}
	}
	created, err := s.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "dashscope", ApiKey: "provider-key"})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Connector.ConnectorId
	if _, err := s.UpdateConnector(userContext("foreign"), &runtimev1.UpdateConnectorRequest{ConnectorId: id, MediaStorage: testOSSUpdate("test-bucket")}); err == nil {
		t.Fatal("foreign storage update admitted")
	}
	if _, err := s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"media_storage"}}}); err == nil {
		t.Fatal("declared but absent storage patch admitted")
	}
	if _, err := s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, MediaStorage: &runtimev1.ConnectorMediaStorageUpdate{Change: &runtimev1.ConnectorMediaStorageUpdate_Remove{Remove: false}}}); err == nil {
		t.Fatal("false removal admitted")
	}
	ignored, err := s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, Label: proto.String("renamed"), MediaStorage: testOSSUpdate("test-bucket"), UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"label"}}})
	if err != nil {
		t.Fatal(err)
	}
	if ignored.Connector.MediaStorage != nil {
		t.Fatal("storage outside update mask was applied")
	}
}
