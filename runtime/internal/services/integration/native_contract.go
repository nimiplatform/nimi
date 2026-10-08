package integration

import (
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func schemaObject(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{"type": "object", "additionalProperties": false, "properties": properties}
	if len(required) != 0 {
		schema["required"] = required
	}
	return schema
}
func schemaText(max int) map[string]any {
	return map[string]any{"type": "string", "minLength": 1, "maxLength": max}
}
func schemaJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

// @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
// These frozen descriptors do not enable a missing adapter implementation.
func nativeOperations(adapter string) []*runtimev1.IntegrationOperation {
	if !isNativeAdapter(adapter) {
		return nil
	}
	kinds := []string{"private"}
	switch adapter {
	case "feishu":
		kinds = []string{"chat", "user"}
	case "qq-official":
		kinds = []string{"c2c", "group"}
	case "onebot-v11":
		kinds = []string{"private", "group"}
	}
	conversation := schemaObject(map[string]any{"kind": map[string]any{"type": "string", "enum": kinds}, "id": schemaText(256)}, "kind", "id")
	asset := schemaObject(map[string]any{"relativePath": schemaText(1024), "sha256": map[string]any{"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"}, "mediaType": schemaText(128), "sizeBytes": map[string]any{"type": "integer", "minimum": 1, "maximum": maxMediaBytes}}, "relativePath", "sha256", "mediaType", "sizeBytes")
	bodies := []any{schemaObject(map[string]any{"kind": map[string]any{"const": "text"}, "text": schemaText(32768)}, "kind", "text"), schemaObject(map[string]any{"kind": map[string]any{"const": "image"}, "asset": asset}, "kind", "asset")}
	// The shape keeps first-batch file paths expressible. Configured adapters
	// narrow admission to their verified platform/recipient/implementation;
	// a descriptor does not establish that an absent handler supports it.
	if adapter != "onebot-v11" {
		bodies = append(bodies, schemaObject(map[string]any{"kind": map[string]any{"const": "file"}, "asset": asset, "fileName": schemaText(255)}, "kind", "asset", "fileName"))
	}
	if adapter == "feishu" {
		bodies = append(bodies, schemaObject(map[string]any{"kind": map[string]any{"const": "card"}, "cardJson": schemaText(65536)}, "kind", "cardJson"))
	}
	body := map[string]any{"oneOf": bodies}
	effectOutput := schemaObject(map[string]any{"confirmation": map[string]any{"type": "string", "enum": []string{"provider-accepted", "message-created"}}, "messageId": map[string]any{"type": "string", "maxLength": 256}}, "confirmation", "messageId")
	if adapter == "qq-official" || adapter == "onebot-v11" {
		effectOutput = schemaObject(map[string]any{"confirmation": map[string]any{"const": "message-created"}, "messageId": schemaText(256)}, "confirmation", "messageId")
	}
	sendRequired := []string{"conversation", "body"}
	sendDescription := "Send one declared message to the selected conversation."
	if adapter == "qq-official" {
		sendRequired = append(sendRequired, "contextRef")
		sendDescription = "Send once to the exact conversation using a current received-message context. Active pushing without context is unavailable."
	}
	makeOp := func(name, description, effect string, input, output any) *runtimev1.IntegrationOperation {
		return &runtimev1.IntegrationOperation{Name: adapter + "." + name, Description: description, InputSchemaJson: schemaJSON(input), OutputSchemaJson: schemaJSON(output), Effect: effect, SupportsCancel: true, RetryPolicy: "none"}
	}
	operations := []*runtimev1.IntegrationOperation{
		makeOp("messages.send", sendDescription, "write", schemaObject(map[string]any{"conversation": conversation, "body": body, "contextRef": schemaText(512)}, sendRequired...), effectOutput),
		makeOp("messages.reply", "Reply once using a current Runtime-owned incoming message reference.", "write", schemaObject(map[string]any{"replyRef": schemaText(512), "body": body}, "replyRef", "body"), effectOutput),
		makeOp("updates.read", "Read new messages from this permitted connection using an independent cursor. Omitted or empty conversations receives all its new messages; nonempty filters select this reader's view and are not permissions.", "read", schemaObject(map[string]any{"cursor": map[string]any{"type": "string", "maxLength": 1024}, "waitMs": map[string]any{"type": "integer", "minimum": 0, "maximum": 25000}, "conversations": map[string]any{"type": "array", "minItems": 0, "maxItems": 64, "uniqueItems": true, "items": schemaText(512)}}), schemaObject(map[string]any{"cursor": schemaText(1024), "events": map[string]any{"type": "array", "maxItems": 32, "items": nativeEventSchema()}, "coverageGap": map[string]any{"type": "string", "enum": []string{"", "restart", "reconnect"}}}, "cursor", "events", "coverageGap")),
		makeOp("media.fetch", "Save the referenced inbound media as a new asset in the invoking App partition.", "read", schemaObject(map[string]any{"mediaRef": schemaText(512), "relativePath": schemaText(1024)}, "mediaRef", "relativePath"), schemaObject(map[string]any{"asset": schemaObject(map[string]any{"relativePath": schemaText(1024), "sha256": schemaText(128), "mediaType": schemaText(128), "sizeBytes": map[string]any{"type": "integer", "minimum": 1, "maximum": maxMediaBytes}, "createdAt": schemaText(64), "modifiedAt": schemaText(64)}, "relativePath", "sha256", "mediaType", "sizeBytes", "createdAt", "modifiedAt"), "integrity": map[string]any{"type": "string", "enum": []string{"protocol-authenticated", "transport-and-local-digest", "decrypted-unverified"}}}, "asset", "integrity")),
	}
	if adapter == "feishu" {
		operations = append(operations, makeOp("messages.update", "Update one existing Feishu text or interactive card message.", "write", schemaObject(map[string]any{"messageId": schemaText(256), "body": map[string]any{"oneOf": []any{bodies[0], schemaObject(map[string]any{"kind": map[string]any{"const": "card"}, "cardJson": schemaText(65536)}, "kind", "cardJson")}}}, "messageId", "body"), effectOutput))
	}
	return operations
}
func nativeEventSchema() any {
	segment := map[string]any{"oneOf": []any{
		schemaObject(map[string]any{"kind": map[string]any{"const": "text"}, "text": map[string]any{"type": "string", "maxLength": 32768}, "origin": map[string]any{"const": "platform-transcription"}}, "kind", "text"),
		schemaObject(map[string]any{"kind": map[string]any{"const": "mention"}, "id": schemaText(256), "displayName": map[string]any{"type": "string", "maxLength": 256}}, "kind", "id", "displayName"),
		schemaObject(map[string]any{"kind": map[string]any{"type": "string", "enum": []string{"image", "file", "audio", "video"}}, "mediaRef": schemaText(512), "fileName": map[string]any{"type": "string", "maxLength": 255}, "mediaType": map[string]any{"type": "string", "maxLength": 128}, "sizeBytes": map[string]any{"type": "integer", "minimum": 0, "maximum": maxMediaBytes}}, "kind", "mediaRef", "fileName", "mediaType", "sizeBytes"),
	}}
	partial := schemaObject(map[string]any{"start": map[string]any{"type": "string", "maxLength": 32768}, "end": map[string]any{"type": "string", "maxLength": 32768}, "startIndex": map[string]any{"type": "integer", "minimum": 0, "maximum": 9007199254740991}, "endIndex": map[string]any{"type": "integer", "minimum": 0, "maximum": 9007199254740991}, "quoteMD5": map[string]any{"type": "string", "maxLength": 128}}, "start", "end", "startIndex", "endIndex", "quoteMD5")
	// @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
	mediaProperties := func(available bool) any {
		properties := map[string]any{"kind": map[string]any{"enum": []string{"image", "file", "audio", "video"}}, "fileName": map[string]any{"type": "string", "maxLength": 255}, "mediaType": map[string]any{"type": "string", "maxLength": 128}, "sizeBytes": map[string]any{"type": "integer", "minimum": 0, "maximum": maxMediaBytes}}
		required := []string{"kind", "mediaRef", "fileName", "mediaType", "sizeBytes"}
		if available {
			properties["mediaRef"] = schemaText(512)
		} else {
			properties["mediaRef"] = map[string]any{"const": ""}
			properties["unavailableReason"] = map[string]any{"enum": []string{"source-not-provided", "source-rejected"}}
			required = append(required, "unavailableReason")
		}
		return schemaObject(properties, required...)
	}
	referenceMedia := map[string]any{"oneOf": []any{mediaProperties(true), mediaProperties(false)}}
	reference := schemaObject(map[string]any{"relation": map[string]any{"enum": []string{"parent", "root"}}, "messageId": map[string]any{"type": "string", "maxLength": 256}, "title": map[string]any{"type": "string", "maxLength": 1024}, "text": map[string]any{"type": "string", "maxLength": 32768}, "origin": map[string]any{"const": "platform-transcription"}, "mediaKind": map[string]any{"enum": []string{"", "image", "file", "audio", "video"}}, "fileName": map[string]any{"type": "string", "maxLength": 255}, "contentStatus": map[string]any{"enum": []string{"text-provided", "media-provided", "media-metadata-only", "not-provided", "unsupported"}}, "partialText": partial, "media": map[string]any{"type": "array", "maxItems": 64, "items": referenceMedia}}, "messageId", "title", "text", "mediaKind", "fileName", "contentStatus")
	return schemaObject(map[string]any{"eventId": schemaText(256), "conversation": schemaObject(map[string]any{"kind": schemaText(32), "id": schemaText(256)}, "kind", "id"), "messageId": map[string]any{"type": "string", "maxLength": 256}, "senderId": map[string]any{"type": "string", "maxLength": 256}, "segments": map[string]any{"type": "array", "maxItems": 64, "items": segment}, "replyRef": map[string]any{"type": "string", "maxLength": 512}, "platformTime": map[string]any{"type": "string", "maxLength": 64}, "receivedAt": schemaText(64), "references": map[string]any{"type": "array", "maxItems": 64, "items": reference}}, "eventId", "conversation", "messageId", "senderId", "segments", "replyRef", "platformTime", "receivedAt")
}
