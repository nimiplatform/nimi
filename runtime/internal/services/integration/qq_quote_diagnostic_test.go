package integration

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func requireQQQuoteDiagnostic(t *testing.T, output []byte) map[string]any {
	t.Helper()
	for _, private := range []string{"PRIVATE_BODY", "PRIVATE_QUOTE", "PRIVATE_FILE", "PRIVATE_ID", "PRIVATE_TOKEN", "PRIVATE_QUERY", "PRIVATE_HOST", "PRIVATE_PATH", "PRIVATE_USER", "PRIVATE_FRAGMENT", "PRIVATE_TYPE", "PRIVATE_NETWORK"} {
		if bytes.Contains(output, []byte(private)) {
			t.Fatal("quote diagnostic exposed a provider value")
		}
	}
	var found map[string]any
	for _, line := range bytes.Split(bytes.TrimSpace(output), []byte("\n")) {
		var record map[string]any
		if json.Unmarshal(line, &record) != nil {
			t.Fatal("invalid diagnostic record")
		}
		if record["msg"] != "QQ quoted file sources classified" {
			continue
		}
		if found != nil {
			t.Fatal("duplicate quote diagnostic")
		}
		found = record
	}
	if found == nil || len(found) != 11 || found["stage"] != "first_reference" || found["level"] != "INFO" {
		t.Fatal("missing or unbounded diagnostic schema")
	}
	if timestamp, ok := found["time"].(string); !ok {
		t.Fatal("missing logger timestamp")
	} else if _, err := time.Parse(time.RFC3339Nano, timestamp); err != nil {
		t.Fatal("invalid logger timestamp")
	}
	switch found["event_type"] {
	case "C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE", "other":
	default:
		t.Fatal("provider event type escaped its fixed classification")
	}
	for _, field := range []string{"attachment_count", "file_attachment_count", "file_source_count", "file_source_policy_accepted_count"} {
		count, ok := found[field].(float64)
		if !ok || count < 0 || count > 64 || count != float64(int(count)) {
			t.Fatal("diagnostic count exceeded its bound")
		}
	}
	for _, field := range []string{"has_file_source", "has_policy_accepted_file_source"} {
		if _, ok := found[field].(bool); !ok {
			t.Fatal("diagnostic presence is not a boolean")
		}
	}
	return found
}

func TestQQQuotedFileSourceDiagnosticPresencePolicyAndPrivacy(t *testing.T) {
	attachment := func(location string) qqAttachment {
		return qqAttachment{Type: "application/PRIVATE_TYPE", URL: location, Name: "PRIVATE_FILE", ASR: "PRIVATE_BODY"}
	}
	maximum := make([]qqAttachment, 64)
	for i := range maximum {
		maximum[i] = attachment("//fixture.qpic.cn/PRIVATE_PATH?token=PRIVATE_TOKEN&key=PRIVATE_QUERY")
	}
	for _, tc := range []struct {
		name        string
		attachments []qqAttachment
		files       int
		sources     int
		accepted    int
	}{
		{"no-attachments", nil, 0, 0, 0},
		{"missing-source", []qqAttachment{attachment(" \t\r\n")}, 1, 0, 0},
		{"accepted-https", []qqAttachment{attachment("https://multimedia.nt.qq.com.cn/PRIVATE_PATH?token=PRIVATE_TOKEN")}, 1, 1, 1},
		{"accepted-network-path", []qqAttachment{attachment(" //fixture.qq.com:443/PRIVATE_PATH?key=PRIVATE_QUERY ")}, 1, 1, 1},
		{"denied-host", []qqAttachment{attachment("https://PRIVATE_HOST.example/PRIVATE_PATH?key=PRIVATE_QUERY")}, 1, 1, 0},
		{"denied-http", []qqAttachment{attachment("http://fixture.qpic.cn/PRIVATE_PATH")}, 1, 1, 0},
		{"denied-userinfo", []qqAttachment{attachment("https://PRIVATE_USER:PRIVATE_TOKEN@fixture.qq.com/PRIVATE_PATH")}, 1, 1, 0}, // pragma: allowlist secret -- synthetic userinfo rejection fixture
		{"denied-parse", []qqAttachment{attachment("https://fixture.qq.com/%PRIVATE_QUERY")}, 1, 1, 0},
		{"denied-bounds", []qqAttachment{attachment(strings.Repeat("PRIVATE_PATH", 819))}, 1, 1, 0},
		{"mixed", []qqAttachment{attachment(""), attachment("https://fixture.qpic.cn/PRIVATE_PATH"), attachment("https://PRIVATE_HOST.example/PRIVATE_PATH"), {Type: "image/png", URL: "https://fixture.qpic.cn/PRIVATE_QUERY", Name: "PRIVATE_FILE"}}, 3, 2, 1},
		{"maximum", maximum, 64, 64, 64},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			s := &Service{logger: slog.New(slog.NewJSONHandler(&output, nil))}
			data := []byte(schemaJSON(map[string]any{"id": "PRIVATE_ID", "content": "PRIVATE_BODY", "message_type": 103, "msg_elements": []map[string]any{{"msg_idx": "PRIVATE_ID", "content": "PRIVATE_QUOTE", "attachments": tc.attachments}, {"attachments": []qqAttachment{attachment("https://PRIVATE_HOST.example/PRIVATE_PATH")}}}}))
			s.logQQQuotedFileSources("PRIVATE_ID", data)
			record := requireQQQuoteDiagnostic(t, output.Bytes())
			if record["event_type"] != "other" || record["attachment_count"] != float64(len(tc.attachments)) || record["file_attachment_count"] != float64(tc.files) || record["file_source_count"] != float64(tc.sources) || record["file_source_policy_accepted_count"] != float64(tc.accepted) || record["has_file_source"] != (tc.sources > 0) || record["has_policy_accepted_file_source"] != (tc.accepted > 0) {
				t.Fatal("source presence or existing policy classification is incorrect")
			}
		})
	}
}

func TestQQQuotedFileSourceDiagnosticRejectsUnboundedAndNonQuoteInput(t *testing.T) {
	for _, data := range [][]byte{
		[]byte(`{"message_type":0,"msg_elements":[{"attachments":[]}]}`),
		[]byte(`{"message_type":103,"msg_elements":[]}`),
		[]byte(`{"message_type":"PRIVATE_TOKEN","msg_elements":[]}`),
		[]byte(`{"message_type":103`),
		[]byte(schemaJSON(map[string]any{"message_type": 103, "msg_elements": make([]map[string]any, 65)})),
		[]byte(schemaJSON(map[string]any{"message_type": 103, "msg_elements": []map[string]any{{"attachments": make([]qqAttachment, 65)}}})),
		bytes.Repeat([]byte("PRIVATE_BODY"), 100000),
	} {
		var output bytes.Buffer
		s := &Service{logger: slog.New(slog.NewJSONHandler(&output, nil))}
		s.logQQQuotedFileSources("GROUP_AT_MESSAGE_CREATE", data)
		if output.Len() != 0 {
			t.Fatal("unbounded or non-quote input emitted a diagnostic")
		}
	}
}

func TestQQActualWebSocketQuoteDiagnosticPreservesPublicMediaAndReferences(t *testing.T) {
	s, feed, _, client, results, output := qqResumeSocketFixture(t)
	var requests atomic.Int32
	s.http = &http.Client{Transport: testRoundTripper(func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		return nil, errors.New("PRIVATE_NETWORK")
	})}
	frame := qqReplayFrame("GROUP_AT_MESSAGE_CREATE", "PRIVATE_ID", 3, "PRIVATE_BODY")
	data := frame["d"].(map[string]any)
	data["message_type"] = 103
	data["attachments"] = []qqAttachment{{Type: "application/octet-stream", URL: "https://fixture.qpic.cn/PRIVATE_PATH?top=PRIVATE_QUERY", Name: "current-file.bin", Size: 16}}
	data["msg_elements"] = []map[string]any{{"msg_idx": "PRIVATE_ID", "content": "PRIVATE_QUOTE", "attachments": []qqAttachment{{Type: "application/octet-stream", URL: "https://fixture.qq.com/PRIVATE_PATH?token=PRIVATE_TOKEN", Name: "PRIVATE_FILE", Size: 32}}}}
	if err := client.WriteJSON(frame); err != nil {
		t.Fatal(err)
	}
	assertQQHeartbeatSequence(t, client, 3)
	// Termination joins the production logger before inspecting its buffer.
	if err := client.WriteJSON(map[string]any{"op": 987654, "t": "PRIVATE_ID"}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-results:
		if publicAdapterError(err) != "INTEGRATION_QQ_FRAME_INVALID" {
			t.Fatal("diagnostic changed the existing protocol rejection", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("socket did not finish")
	}
	record := requireQQQuoteDiagnostic(t, output.Bytes())
	if record["event_type"] != "GROUP_AT_MESSAGE_CREATE" || record["file_source_count"] != float64(1) || record["file_source_policy_accepted_count"] != float64(1) || requests.Load() != 0 {
		t.Fatal("production wiring did not classify locally without a download")
	}
	feed.mu.Lock()
	defer feed.mu.Unlock()
	if len(feed.events) != 1 || feed.qqSequence != 3 || len(feed.events[0].sources) != 3 {
		t.Fatal("feed commitment or independent quote source missing")
	}
	var event nativeMessage
	if json.Unmarshal(feed.events[0].payload, &event) != nil || len(event.References) != 1 || event.References[0].MessageID != "" || event.References[0].FileName != "PRIVATE_FILE" || event.References[0].Text != "PRIVATE_QUOTE" {
		t.Fatal("public reference projection changed")
	}
	if len(event.References[0].Media) != 1 || event.References[0].Media[0].MediaRef == "" || event.References[0].Media[0].MediaRef == event.ReplyRef {
		t.Fatal("quoted attachment missing its independent media capability")
	}
	var currentMedia bool
	for _, segment := range event.Segments {
		if segment["kind"] == "file" {
			currentMedia = segment["mediaRef"] != "" && segment["fileName"] == "current-file.bin"
		}
	}
	if !currentMedia || bytes.Contains(feed.events[0].payload, []byte("https://")) {
		t.Fatal("current attachment changed or a private URL escaped")
	}
}
