package integration

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestNativeMessagingDescriptorsRejectUndeclaredInputAndFalseConfirmation(t *testing.T) {
	for _, adapter := range []string{"weixin", "feishu", "qq-official", "onebot-v11"} {
		t.Run(adapter, func(t *testing.T) {
			ops := nativeOperations(adapter)
			if err := validateOperations(ops); err != nil {
				t.Fatal(err)
			}
			read := operation(target{Public: &runtimev1.IntegrationTarget{Operations: ops}}, adapter+".updates.read")
			for _, input := range []map[string]any{{}, {"conversations": []any{}}, {"conversations": []any{"private:known"}}} {
				if err := validateSchema(read.InputSchemaJson, input); err != nil {
					t.Fatal("declared optional conversation view rejected", err)
				}
			}
			for _, input := range []map[string]any{{"conversations": nil}, {"conversations": "*"}, {"conversations": []any{""}}, {"conversations": []any{"private:1", "private:1"}}, {"foreignTarget": "other"}} {
				if err := validateSchema(read.InputSchemaJson, input); err == nil {
					t.Fatal("invalid optional conversation view admitted", input)
				}
			}
			tooMany := make([]string, 65)
			for i := range tooMany {
				tooMany[i] = fmt.Sprintf("private:%d", i)
			}
			if err := validateSchema(read.InputSchemaJson, map[string]any{"conversations": tooMany}); err == nil {
				t.Fatal("conversation limit lost")
			}
			kind := map[string]string{"weixin": "private", "feishu": "chat", "qq-official": "c2c", "onebot-v11": "group"}[adapter]
			input := map[string]any{"conversation": map[string]any{"kind": kind, "id": "specified-recipient"}, "body": map[string]any{"kind": "text", "text": "message"}}
			if adapter == "qq-official" {
				if err := validateSchema(ops[0].InputSchemaJson, input); err == nil {
					t.Fatal("QQ omitted required source context")
				}
				input["contextRef"] = "opaque-current-source"
			}
			if err := validateSchema(ops[0].InputSchemaJson, input); err != nil {
				t.Fatal(err)
			}
			input["secret"] = "must-not-cross-App-boundary"
			if err := validateSchema(ops[0].InputSchemaJson, input); err == nil {
				t.Fatal("undeclared credential field admitted")
			}
			delete(input, "secret")
			if err := validateSchema(ops[0].OutputSchemaJson, map[string]any{"httpStatus": 200}); err == nil {
				t.Fatal("transport status admitted as confirmation")
			}
			if err := validateSchema(ops[0].OutputSchemaJson, map[string]any{"confirmation": "provider-accepted", "messageId": ""}); (err == nil) != (adapter != "qq-official" && adapter != "onebot-v11") {
				t.Fatal("adapter receipt requirement disagrees with descriptor", err)
			}
			input["body"] = map[string]any{"kind": "file", "asset": map[string]any{"relativePath": "owned/file.txt", "sha256": "sha256:0000000000000000000000000000000000000000000000000000000000000000", "mediaType": "text/plain", "sizeBytes": float64(12)}, "fileName": "file.txt"}
			if err := validateSchema(ops[0].InputSchemaJson, input); (err == nil) != (adapter != "onebot-v11") {
				t.Fatal("file admission disagrees with implemented, verified protocol path", err)
			}
			input["body"] = map[string]any{"kind": "card", "cardJson": "{\"elements\":[]}"}
			if err := validateSchema(ops[0].InputSchemaJson, input); (err == nil) != (adapter == "feishu") {
				t.Fatal("initial card admission disagrees with the adapter", err)
			}
		})
	}
}

func TestNativeConfigurationKeepsExplicitFirstBatchPaths(t *testing.T) {
	for _, config := range []*runtimev1.IntegrationConnectionConfig{
		{Feishu: &runtimev1.IntegrationFeishuConfig{SetupMode: "manual", AppId: "cli_actual"}},
		{Feishu: &runtimev1.IntegrationFeishuConfig{SetupMode: "create"}},
		{OnebotV11: &runtimev1.IntegrationOneBotV11Config{Listener: "192.168.1.2:6700", SelfId: "12345"}},
	} {
		adapter := "feishu"
		if config.OnebotV11 != nil {
			adapter = "onebot-v11"
		}
		if err := validateConnectionConfig(adapter, config); err != nil {
			t.Fatal("selected path cannot be expressed", err)
		}
	}
	for _, config := range []*runtimev1.IntegrationConnectionConfig{
		{Feishu: &runtimev1.IntegrationFeishuConfig{SetupMode: "create", AppId: "existing-app"}},
		{Feishu: &runtimev1.IntegrationFeishuConfig{SetupMode: "manual"}},
		{Feishu: &runtimev1.IntegrationFeishuConfig{SetupMode: "unknown"}},
	} {
		if err := validateConnectionConfig("feishu", config); err == nil {
			t.Fatal("ambiguous setup configuration admitted")
		}
	}
}
