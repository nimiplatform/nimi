package realmrealtime

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRealtimeAndReplayPreserveAuthorizedAttachmentView(t *testing.T) {
	for _, grant := range []string{"live", "replay"} {
		raw := fmt.Sprintf(`{"id":"message-1","chatId":"chat-1","senderId":"user-1","type":"ATTACHMENT","payload":{"attachment":{"targetType":"RESOURCE","targetId":"resource-1","displayKind":"IMAGE","externalUrl":"https://external.example/image","unavailable":false,"delivery":{"resourceId":"resource-1","contentVersion":"%s","publicationGeneration":2,"policyVersion":"v1","expiresAt":"2099-01-01T00:00:00Z","images":[{"purpose":"chat","families":[{"mimeType":"image/webp","sources":[{"url":"https://media.example/%s.webp","width":320,"height":180,"mimeType":"image/webp"}]}]}]}}},"isRead":false,"createdAt":"2026-11-17T01:00:00Z"}`, strings.Repeat("a", 64), grant)
		var message wireChatMessage
		if err := json.Unmarshal([]byte(raw), &message); err != nil {
			t.Fatal(err)
		}
		history, err := convertWireMessage(message)
		if err != nil {
			t.Fatal(err)
		}
		event, err := convertWireChatEvent(wireChatEvent{StreamID: "chat-1", Seq: 1, EventID: "event-1", ChatID: "chat-1", ActorID: "user-1", OccurredAt: "2026-11-17T01:00:00Z", Kind: "message.created", Payload: json.RawMessage(`{"message":` + raw + `}`)})
		if err != nil {
			t.Fatal(err)
		}
		for _, converted := range []*runtimev1.RealmChatMessage{history, event.GetMessageCreated().GetMessage()} {
			attachment := converted.GetPayload().GetAttachment()
			if attachment.GetTargetId() != "resource-1" || attachment.GetTargetType() != runtimev1.RealmAttachmentTargetType_REALM_ATTACHMENT_TARGET_TYPE_RESOURCE ||
				attachment.GetDisplayKind() != runtimev1.RealmAttachmentDisplayKind_REALM_ATTACHMENT_DISPLAY_KIND_IMAGE || attachment.GetExternalUrl() != "https://external.example/image" ||
				attachment.GetDelivery().GetResourceId() != "resource-1" || attachment.GetDelivery().GetImages()[0].GetFamilies()[0].GetSources()[0].GetUrl() != "https://media.example/"+grant+".webp" {
				t.Fatalf("attachment lost its authorized view: %+v", attachment)
			}
		}
	}
	attachment, err := convertAttachment(wireAttachment{TargetType: "RESOURCE", TargetID: "resource-1", DisplayKind: "IMAGE", Unavailable: true})
	if err != nil || !attachment.GetUnavailable() || attachment.GetDelivery() != nil {
		t.Fatalf("unavailable resource became deliverable: %+v %v", attachment, err)
	}
}
