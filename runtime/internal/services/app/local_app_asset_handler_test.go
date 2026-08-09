package app

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestProtectedLocalAppAssetCRUDStreamingRangeAndOwnerIsolation(t *testing.T) {
	service := newTestService(WithAppStorageDataRoot(t.TempDir()))
	payload := bytes.Repeat([]byte("stream-body-"), 150000)
	write := &localAppAssetWriteTestStream{
		ctx: localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetWrite, "account-a", "subject-a"),
		requests: []*runtimev1.WriteLocalAppAssetRequest{
			{Frame: &runtimev1.WriteLocalAppAssetRequest_Metadata{Metadata: &runtimev1.WriteLocalAppAssetMetadata{RelativePath: "media/run.bin", MediaType: "application/octet-stream"}}},
			{Frame: &runtimev1.WriteLocalAppAssetRequest_BodyChunk{BodyChunk: payload[:appstorage.AssetChunkBytes]}},
			{Frame: &runtimev1.WriteLocalAppAssetRequest_BodyChunk{BodyChunk: payload[appstorage.AssetChunkBytes:]}},
		},
	}
	if err := service.WriteLocalAppAsset(write); err != nil || write.response.GetAsset().GetSizeBytes() != int64(len(payload)) {
		t.Fatalf("write response=%+v err=%v", write.response, err)
	}

	stat, err := service.StatLocalAppAsset(
		localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetStat, "account-a", "subject-a"),
		&runtimev1.StatLocalAppAssetRequest{RelativePath: "media/run.bin"},
	)
	if err != nil || stat.GetAsset().GetSha256() != write.response.GetAsset().GetSha256() {
		t.Fatalf("stat=%+v err=%v", stat, err)
	}

	list, err := service.ListLocalAppAssets(
		localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetList, "account-a", "subject-a"),
		&runtimev1.ListLocalAppAssetsRequest{Prefix: "media/", PageSize: 10},
	)
	if err != nil || len(list.GetAssets()) != 1 || list.GetAssets()[0].GetRelativePath() != "media/run.bin" {
		t.Fatalf("list=%+v err=%v", list, err)
	}

	offset, length := int64(7), int64(1234567)
	read := &localAppAssetReadTestStream{ctx: localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetRead, "account-a", "subject-a")}
	if err := service.ReadLocalAppAsset(&runtimev1.ReadLocalAppAssetRequest{RelativePath: "media/run.bin", Offset: &offset, Length: &length}, read); err != nil {
		t.Fatal(err)
	}
	metadataFrame := read.responses[0].GetMetadata()
	if metadataFrame == nil || metadataFrame.GetRange().GetOffset() != offset || metadataFrame.GetRange().GetLength() != length || metadataFrame.GetRange().GetTotalSize() != int64(len(payload)) {
		t.Fatalf("read metadata=%+v", metadataFrame)
	}
	if got := collectLocalAppAssetReadBody(read.responses); !bytes.Equal(got, payload[offset:offset+length]) {
		t.Fatalf("ranged body length=%d", len(got))
	}

	for _, foreign := range []struct{ account, subject string }{{"account-b", "subject-a"}, {"account-a", "subject-b"}} {
		_, err := service.StatLocalAppAsset(
			localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetStat, foreign.account, foreign.subject),
			&runtimev1.StatLocalAppAssetRequest{RelativePath: "media/run.bin"},
		)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("foreign owner (%s,%s) err=%v", foreign.account, foreign.subject, err)
		}
	}

	moved, err := service.MoveLocalAppAsset(
		localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetMove, "account-a", "subject-a"),
		&runtimev1.MoveLocalAppAssetRequest{FromRelativePath: "media/run.bin", ToRelativePath: "archive/run.bin"},
	)
	if err != nil || moved.GetAsset().GetRelativePath() != "archive/run.bin" {
		t.Fatalf("move=%+v err=%v", moved, err)
	}
	removeContext := localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetRemove, "account-a", "subject-a")
	removed, err := service.RemoveLocalAppAsset(removeContext, &runtimev1.RemoveLocalAppAssetRequest{RelativePath: "archive/run.bin"})
	if err != nil || !removed.GetRemoved() {
		t.Fatalf("remove=%+v err=%v", removed, err)
	}
	removed, err = service.RemoveLocalAppAsset(removeContext, &runtimev1.RemoveLocalAppAssetRequest{RelativePath: "archive/run.bin"})
	if err != nil || removed.GetRemoved() {
		t.Fatalf("idempotent remove=%+v err=%v", removed, err)
	}
}

func TestProtectedLocalAppAssetReadHoldsOneCommittedVersion(t *testing.T) {
	service := newTestService(WithAppStorageDataRoot(t.TempDir()))
	writeAssetThroughService(t, service, "version.bin", []byte("old-version"), false)
	metadataSent := make(chan struct{})
	release := make(chan struct{})
	read := &localAppAssetReadTestStream{
		ctx: localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetRead, "account-a", "subject-a"),
		onSend: func(response *runtimev1.ReadLocalAppAssetResponse) {
			if response.GetMetadata() != nil {
				close(metadataSent)
				<-release
			}
		},
	}
	readErr := make(chan error, 1)
	go func() {
		readErr <- service.ReadLocalAppAsset(&runtimev1.ReadLocalAppAssetRequest{RelativePath: "version.bin"}, read)
	}()
	<-metadataSent
	writeAssetThroughService(t, service, "version.bin", []byte("new-version"), true)
	close(release)
	if err := <-readErr; err != nil {
		t.Fatal(err)
	}
	if got := string(collectLocalAppAssetReadBody(read.responses)); got != "old-version" {
		t.Fatalf("open read spliced versions: %q", got)
	}
}

func TestProtectedLocalAppAssetFrameRangeAndTypedFailures(t *testing.T) {
	service := newTestService(WithAppStorageDataRoot(t.TempDir()))
	invalidFirst := &localAppAssetWriteTestStream{
		ctx:      localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetWrite, "account-a", "subject-a"),
		requests: []*runtimev1.WriteLocalAppAssetRequest{{Frame: &runtimev1.WriteLocalAppAssetRequest_BodyChunk{BodyChunk: []byte("not-metadata")}}},
	}
	assertLocalAppAssetReason(t, service.WriteLocalAppAsset(invalidFirst), codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)

	invalidMedia := &localAppAssetWriteTestStream{
		ctx: localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetWrite, "account-a", "subject-a"),
		requests: []*runtimev1.WriteLocalAppAssetRequest{
			{Frame: &runtimev1.WriteLocalAppAssetRequest_Metadata{Metadata: &runtimev1.WriteLocalAppAssetMetadata{RelativePath: "media.bin", MediaType: "bad media"}}},
		},
	}
	assertLocalAppAssetReason(t, service.WriteLocalAppAsset(invalidMedia), codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)

	writeAssetThroughService(t, service, "range.bin", []byte("1234"), false)
	for name, request := range map[string]*runtimev1.ReadLocalAppAssetRequest{
		"negative offset": {RelativePath: "range.bin", Offset: int64Pointer(-1)},
		"zero length":     {RelativePath: "range.bin", Length: int64Pointer(0)},
		"past eof":        {RelativePath: "range.bin", Offset: int64Pointer(5)},
		"unsafe":          {RelativePath: "range.bin", Offset: int64Pointer(localAppAssetMaxSafeInteger + 1)},
	} {
		t.Run(name, func(t *testing.T) {
			stream := &localAppAssetReadTestStream{ctx: localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetRead, "account-a", "subject-a")}
			assertLocalAppAssetReason(t, service.ReadLocalAppAsset(request, stream), codes.OutOfRange, runtimev1.ReasonCode_APP_STORAGE_RANGE_INVALID)
		})
	}
	eof := int64(4)
	empty := &localAppAssetReadTestStream{ctx: localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetRead, "account-a", "subject-a")}
	if err := service.ReadLocalAppAsset(&runtimev1.ReadLocalAppAssetRequest{RelativePath: "range.bin", Offset: &eof}, empty); err != nil || len(empty.responses) != 1 || empty.responses[0].GetMetadata().GetRange().GetLength() != 0 {
		t.Fatalf("EOF read responses=%+v err=%v", empty.responses, err)
	}

	_, err := service.ListLocalAppAssets(
		localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetList, "account-a", "subject-a"),
		&runtimev1.ListLocalAppAssetsRequest{Prefix: "bad//", PageSize: 10},
	)
	assertLocalAppAssetReason(t, err, codes.InvalidArgument, runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID)
}

func writeAssetThroughService(t *testing.T, service *Service, path string, payload []byte, overwrite bool) *runtimev1.LocalAppAssetRecord {
	t.Helper()
	stream := &localAppAssetWriteTestStream{
		ctx: localAppAssetTestContext(accountservice.LocalAppOperationStorageAssetWrite, "account-a", "subject-a"),
		requests: []*runtimev1.WriteLocalAppAssetRequest{
			{Frame: &runtimev1.WriteLocalAppAssetRequest_Metadata{Metadata: &runtimev1.WriteLocalAppAssetMetadata{RelativePath: path, Overwrite: overwrite}}},
			{Frame: &runtimev1.WriteLocalAppAssetRequest_BodyChunk{BodyChunk: payload}},
		},
	}
	if err := service.WriteLocalAppAsset(stream); err != nil {
		t.Fatal(err)
	}
	return stream.response.GetAsset()
}

func localAppAssetTestContext(operation accountservice.LocalAppOperation, accountID, subject string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID: accountID, RegisteredAppSubject: subject, Operation: operation,
		AuthorityClass: localappop.AuthorityClassBase, OperationCapability: appstorage.LocalAppPrivateStorageEntitlement,
		ExpiresAt: time.Now().Add(time.Minute),
	})
}

func assertLocalAppAssetReason(t *testing.T, err error, wantCode codes.Code, wantReason runtimev1.ReasonCode) {
	t.Helper()
	reason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != wantCode || reason != wantReason {
		t.Fatalf("failure code=%s reason=%s err=%v", status.Code(err), reason, err)
	}
	if message := status.Convert(err).Message(); strings.Contains(message, "account-a") || strings.Contains(message, "subject-a") {
		t.Fatalf("protected owner leaked: %q", message)
	}
}

func collectLocalAppAssetReadBody(responses []*runtimev1.ReadLocalAppAssetResponse) []byte {
	var body []byte
	for _, response := range responses {
		body = append(body, response.GetBodyChunk()...)
	}
	return body
}

func int64Pointer(value int64) *int64 { return &value }

type localAppAssetWriteTestStream struct {
	ctx      context.Context
	requests []*runtimev1.WriteLocalAppAssetRequest
	response *runtimev1.WriteLocalAppAssetResponse
	index    int
}

func (stream *localAppAssetWriteTestStream) Recv() (*runtimev1.WriteLocalAppAssetRequest, error) {
	if stream.index >= len(stream.requests) {
		return nil, io.EOF
	}
	request := stream.requests[stream.index]
	stream.index++
	return request, nil
}

func (stream *localAppAssetWriteTestStream) SendAndClose(response *runtimev1.WriteLocalAppAssetResponse) error {
	stream.response = response
	return nil
}

func (stream *localAppAssetWriteTestStream) SetHeader(metadata.MD) error  { return nil }
func (stream *localAppAssetWriteTestStream) SendHeader(metadata.MD) error { return nil }
func (stream *localAppAssetWriteTestStream) SetTrailer(metadata.MD)       {}
func (stream *localAppAssetWriteTestStream) Context() context.Context     { return stream.ctx }
func (stream *localAppAssetWriteTestStream) SendMsg(any) error            { return nil }
func (stream *localAppAssetWriteTestStream) RecvMsg(any) error            { return io.EOF }

type localAppAssetReadTestStream struct {
	ctx       context.Context
	responses []*runtimev1.ReadLocalAppAssetResponse
	onSend    func(*runtimev1.ReadLocalAppAssetResponse)
}

func (stream *localAppAssetReadTestStream) Send(response *runtimev1.ReadLocalAppAssetResponse) error {
	stream.responses = append(stream.responses, response)
	if stream.onSend != nil {
		stream.onSend(response)
	}
	return nil
}

func (stream *localAppAssetReadTestStream) SetHeader(metadata.MD) error  { return nil }
func (stream *localAppAssetReadTestStream) SendHeader(metadata.MD) error { return nil }
func (stream *localAppAssetReadTestStream) SetTrailer(metadata.MD)       {}
func (stream *localAppAssetReadTestStream) Context() context.Context     { return stream.ctx }
func (stream *localAppAssetReadTestStream) SendMsg(any) error            { return nil }
func (stream *localAppAssetReadTestStream) RecvMsg(any) error            { return io.EOF }
