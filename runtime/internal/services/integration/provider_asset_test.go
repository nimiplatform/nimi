package integration

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

type transferFixture struct {
	s             *Service
	assets        *publicationAssets
	c, p          accountservice.LocalAppCallerDecision
	target        string
	send, receive appstorage.ManagedOwner
	endpoint      *runtimev1.IntegrationAssetEndpoint
	destination   *runtimev1.IntegrationAssetEndpoint
	payload       []byte
	mode          string
}

func assetFixture(t *testing.T, mode string) *transferFixture {
	t.Helper()
	svc := newIntegrationTestService(t, nil)
	store, err := appstorage.NewAssetStore(t.TempDir(), appstorage.AssetPolicy{MinFreeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	assets := &publicationAssets{store: store, prepared: make(chan struct{}), release: make(chan struct{})}
	svc.assets = assets
	f := &transferFixture{s: svc, assets: assets, c: testDecision("consumer", 3), p: testDecision("provider", 4), mode: mode}
	op := testOperation("write")
	op.Name = "session.file"
	op.AssetTransfer = &mode
	target, err := svc.RegisterIntegrationProvider(testContext(f.p, localappop.OperationIntegrationProviderRegister), &runtimev1.RegisterIntegrationProviderRequest{
		IntegrationId: "app-files", DisplayName: "App files", Operations: []*runtimev1.IntegrationOperation{op},
	})
	if err != nil {
		t.Fatal(err)
	}
	f.target = target.Target.TargetRef
	f.send = appstorage.ManagedOwner{AccountID: f.c.AccountID, RegisteredAppSubject: f.c.RegisteredAppSubject}
	f.receive = appstorage.ManagedOwner{AccountID: f.p.AccountID, RegisteredAppSubject: f.p.RegisteredAppSubject}
	if mode == assetToConsumer {
		f.send, f.receive = f.receive, f.send
	}
	f.payload = bytes.Repeat([]byte("managed file contents\n"), 65536)
	rec, err := store.Write(context.Background(), f.send, "original/document", "application/octet-stream", false, io.NopCloser(bytes.NewReader(f.payload)))
	if err != nil {
		t.Fatal(err)
	}
	f.endpoint = &runtimev1.IntegrationAssetEndpoint{RelativePath: rec.RelativePath, Source: &runtimev1.IntegrationAssetInfo{SizeBytes: uint32(rec.SizeBytes), Sha256: rec.SHA256, MediaType: rec.MediaType}}
	f.destination = &runtimev1.IntegrationAssetEndpoint{RelativePath: "received/document"}
	return f
}

func (f *transferFixture) invoke(asset *runtimev1.IntegrationAssetEndpoint) (*runtimev1.InvokeIntegrationCallResponse, error) {
	return f.s.InvokeIntegrationCall(testContext(f.c, localappop.OperationIntegrationCallInvoke), &runtimev1.InvokeIntegrationCallRequest{
		TargetRef: f.target, Operation: "session.file", InputJson: `{"session":"s"}`, Asset: asset,
	})
}
func (f *transferFixture) offer(t *testing.T) string {
	t.Helper()
	caller := f.endpoint
	if f.mode == assetToConsumer {
		caller = f.destination
	}
	if _, err := f.invoke(caller); err == nil {
		t.Fatal("transfer admitted before its operation grant")
	}
	grantTestTarget(t, f.s, f.c, f.target, "session.file")
	if _, err := f.invoke(nil); err == nil {
		t.Fatal("transfer admitted without owner's endpoint")
	}
	result, err := f.invoke(caller)
	if err != nil {
		t.Fatal(err)
	}
	polled, err := f.s.PollIntegrationProvider(testContext(f.p, localappop.OperationIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{})
	if err != nil || len(polled.Calls) != 1 {
		t.Fatal(polled, err)
	}
	call := polled.Calls[0]
	if call.InputJson != `{"session":"s"}` || call.CallId != result.Call.CallId {
		t.Fatal(call)
	}
	if f.mode == assetToProvider && !proto.Equal(call.OfferedAsset, f.endpoint.Source) || f.mode == assetToConsumer && call.OfferedAsset != nil {
		t.Fatal("unexpected offered metadata", call)
	}
	return call.CallId
}
func (f *transferFixture) complete(id string, endpoint *runtimev1.IntegrationAssetEndpoint) (*runtimev1.CompleteIntegrationProviderResponse, error) {
	return f.s.CompleteIntegrationProvider(testContext(f.p, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{
		CallId: id, ResultJson: `{"receipt":"opaque-id"}`, Asset: endpoint,
	})
}

func TestAppProviderAssetTransferAcrossPartitions(t *testing.T) {
	for _, mode := range []string{assetToProvider, assetToConsumer} {
		t.Run(mode, func(t *testing.T) {
			f := assetFixture(t, mode)
			close(f.assets.release)
			id := f.offer(t)
			provider := f.destination
			if mode == assetToConsumer {
				provider = f.endpoint
			}
			result, err := f.complete(id, provider)
			if err != nil || !result.Accepted {
				t.Fatal(result, err)
			}
			fact := waitTestCall(t, f.s, f.c, id)
			if fact.Status != "completed" || fact.ResultJson != `{"receipt":"opaque-id"}` {
				t.Fatal(fact)
			}
			received, err := f.assets.store.Open(context.Background(), f.receive, f.destination.RelativePath)
			if err != nil {
				t.Fatal(err)
			}
			contents, err := io.ReadAll(received.Body)
			_ = received.Body.Close()
			if err != nil || !bytes.Equal(contents, f.payload) || received.Record.SHA256 != f.endpoint.Source.Sha256 {
				t.Fatal("transferred bytes changed", err)
			}
			if _, err = f.assets.store.Open(context.Background(), f.receive, f.endpoint.RelativePath); err == nil {
				t.Fatal("receiver can open private source path")
			}
			repeat, err := f.complete(id, provider)
			if err != nil || repeat.Accepted {
				t.Fatal("terminal completion repeated", repeat, err)
			}
			// A second accepted invocation cannot overwrite the first destination.
			caller := f.endpoint
			if mode == assetToConsumer {
				caller = f.destination
			}
			again, err := f.invoke(caller)
			if err != nil {
				t.Fatal(err)
			}
			_, err = f.s.PollIntegrationProvider(testContext(f.p, localappop.OperationIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.complete(again.Call.CallId, provider); err == nil {
				t.Fatal("overwrote occupied destination")
			}
			failed := waitTestCall(t, f.s, f.c, again.Call.CallId)
			if failed.Status == "completed" || failed.ResultJson != "" {
				t.Fatal(failed)
			}
		})
	}
}

func TestAppProviderRevocationBeforeAssetPublication(t *testing.T) {
	f := assetFixture(t, assetToProvider)
	id := f.offer(t)
	done := make(chan struct{})
	go func() {
		r, err := f.complete(id, f.destination)
		if err == nil && r.Accepted {
			t.Error("accepted after revocation")
		}
		close(done)
	}()
	select {
	case <-f.assets.prepared:
	case <-time.After(3 * time.Second):
		t.Fatal("asset not prepared")
	}
	grantTestTarget(t, f.s, f.c, f.target)
	close(f.assets.release)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("publication did not settle")
	}
	fact := waitTestCall(t, f.s, f.c, id)
	if fact.Status != "unconfirmed" {
		t.Fatal(fact)
	}
	if _, err := f.assets.store.Open(context.Background(), f.receive, f.destination.RelativePath); err == nil {
		t.Fatal("revoked bytes published")
	}
}

func TestAppProviderRejectsChangedAssetAndOperationContract(t *testing.T) {
	f := assetFixture(t, assetToProvider)
	close(f.assets.release)
	id := f.offer(t)
	if _, err := f.assets.store.Write(context.Background(), f.send, f.endpoint.RelativePath, "application/octet-stream", true, io.NopCloser(bytes.NewReader([]byte("changed")))); err != nil {
		t.Fatal(err)
	}
	if _, err := f.complete(id, f.destination); err == nil {
		t.Fatal("source change was ignored")
	}
	fact := waitTestCall(t, f.s, f.c, id)
	if fact.ErrorCode != "INTEGRATION_MEDIA_INTEGRITY_INVALID" {
		t.Fatal(fact)
	}
	mode := assetToConsumer
	op := testOperation("write")
	op.Name = "session.file"
	op.AssetTransfer = &mode
	if _, err := f.s.RegisterIntegrationProvider(testContext(f.p, localappop.OperationIntegrationProviderRegister), &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "app-files", DisplayName: "App files", Operations: []*runtimev1.IntegrationOperation{op}}); err == nil {
		t.Fatal("changed direction kept existing grant")
	}
}

func TestAppProviderAssetRejectsForeignSourceAndInvalidOffer(t *testing.T) {
	f := assetFixture(t, assetToProvider)
	close(f.assets.release)
	grantTestTarget(t, f.s, f.c, f.target, "session.file")
	for _, modify := range []func(*runtimev1.IntegrationAssetEndpoint){
		func(v *runtimev1.IntegrationAssetEndpoint) { v.RelativePath = "../other/document" },
		func(v *runtimev1.IntegrationAssetEndpoint) { v.Source.SizeBytes = maxMediaBytes + 1 },
		func(v *runtimev1.IntegrationAssetEndpoint) { v.Source.Sha256 = "invalid" },
		func(v *runtimev1.IntegrationAssetEndpoint) { v.Source = nil },
	} {
		candidate := proto.Clone(f.endpoint).(*runtimev1.IntegrationAssetEndpoint)
		modify(candidate)
		if _, err := f.invoke(candidate); err == nil {
			t.Fatal("invalid source was accepted")
		}
	}
	foreign := proto.Clone(f.endpoint).(*runtimev1.IntegrationAssetEndpoint)
	foreign.RelativePath = "private/another-source"
	if _, err := f.assets.store.Write(context.Background(), f.receive, foreign.RelativePath, foreign.Source.MediaType, false, io.NopCloser(bytes.NewReader(f.payload))); err != nil {
		t.Fatal(err)
	}
	request, err := f.invoke(foreign)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.s.PollIntegrationProvider(testContext(f.p, localappop.OperationIntegrationProviderPoll), &runtimev1.PollIntegrationProviderRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.complete(request.Call.CallId, f.destination); err == nil {
		t.Fatal("copied a source in a different partition")
	}
	if _, err = f.assets.store.Open(context.Background(), f.receive, f.destination.RelativePath); err == nil {
		t.Fatal("published a foreign source")
	}
}
