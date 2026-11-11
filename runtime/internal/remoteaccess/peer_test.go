package remoteaccess

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestRemoteErrorFramePreservesOwnerReasonAndPublicMessage(t *testing.T) {
	ownerError := grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_STORAGE_ENTRY_NOT_FOUND,
		errors.New("private storage path"), grpcerr.ReasonOptions{Message: "local app storage operation failed", ActionHint: "inspect_storage_path"})
	encoded, err := proto.Marshal(remoteErrorFrame(7, ownerError))
	if err != nil {
		t.Fatal(err)
	}
	frame := &runtimev1.RemoteTransportFrame{}
	if err := proto.Unmarshal(encoded, frame); err != nil {
		t.Fatal(err)
	}
	if frame.Kind != runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_ERROR || frame.RequestId != 7 || frame.GrpcCode != uint32(codes.NotFound) || !frame.ChunkEnd {
		t.Fatalf("invalid error frame: %v", frame)
	}
	if frame.ErrorInfo.GetReasonCode() != runtimev1.ReasonCode_APP_STORAGE_ENTRY_NOT_FOUND || frame.ErrorInfo.GetActionHint() != "inspect_storage_path" || frame.ErrorInfo.GetMessage() != "local app storage operation failed" || frame.Message != frame.ErrorInfo.GetMessage() {
		t.Fatalf("owner error lost its typed projection: %v", frame)
	}
	denied := remoteErrorFrame(8, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN))
	if denied.ErrorInfo.GetReasonCode() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN || denied.ErrorInfo.GetMessage() != "APP_SCOPE_FORBIDDEN" {
		t.Fatalf("reason-only owner failure was lost: %v", denied)
	}
	plain := remoteErrorFrame(9, status.Error(codes.Unavailable, "transport closed"))
	if plain.ErrorInfo != nil || plain.GrpcCode != uint32(codes.Unavailable) || plain.Message != "transport closed" {
		t.Fatalf("invented owner reason for plain status: %v", plain)
	}
}

func TestPeerPublicationRejectsClosedExpiredOrReplacedScope(t *testing.T) {
	for _, mutation := range []string{"closed", "deadline", "account", "session", "request"} {
		t.Run(mutation, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			invalidated := make(chan struct{})
			id := protectedlocal.Identifier{1}
			peer := &Peer{ctx: context.Background(), info: PeerInfo{SessionID: id, Deadline: time.Now().Add(time.Minute), AccountInvalidated: invalidated}}
			published := 0
			if err := peer.Commit(ctx, id, func() error { published++; return nil }); err != nil {
				t.Fatal(err)
			}
			switch mutation {
			case "closed":
				peer.closed = true
			case "deadline":
				peer.info.Deadline = time.Now().Add(-time.Second)
			case "account":
				close(invalidated)
			case "session":
				id = protectedlocal.Identifier{2}
			case "request":
				cancel()
			}
			if err := peer.Commit(ctx, id, func() error { published++; return nil }); err == nil || published != 1 {
				t.Fatal("invalid peer published a mutation", err)
			}
		})
	}
}

// This is a live transport test, not Runtime/AI or source-confirmation acceptance.
func TestLiveDirectDataChannelFragmentsAndRejectsRequestReplay(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	api := loopbackPeerAPI()
	client, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	protocol := channelProtocol
	channel, err := client.CreateDataChannel(channelLabel, &webrtc.DataChannelInit{Protocol: &protocol})
	if err != nil {
		t.Fatal(err)
	}
	opened := make(chan struct{})
	channel.OnOpen(func() { close(opened) })
	frames := make(chan *runtimev1.RemoteTransportFrame, 16)
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		frame := &runtimev1.RemoteTransportFrame{}
		if proto.Unmarshal(message.Data, frame) == nil {
			frames <- frame
		}
	})
	created, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(client)
	if err = client.SetLocalDescription(created); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var dispatched atomic.Int32
	assertLoopbackCandidates(t, client.LocalDescription().SDP)
	server, answer, err := newPeer(ctx, ctx, api, PeerInfo{Deadline: time.Now().Add(time.Minute), AccountInvalidated: make(chan struct{})}, client.LocalDescription().SDP, nil,
		func(_ context.Context, _ *Peer, call Call, _ func([]byte) error) ([]byte, bool, error) {
			if call.IdempotencyKey != "direct-config-control" {
				t.Error("lost non-authorizing idempotency control")
			}
			dispatched.Add(1)
			return bytes.ToUpper(call.Payload), false, nil
		})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	assertLoopbackCandidates(t, answer)
	if err = client.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-opened:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	payload := bytes.Repeat([]byte("fragment-data"), 4000)
	send := func(frame *runtimev1.RemoteTransportFrame) {
		t.Helper()
		data, err := proto.Marshal(frame)
		if err != nil {
			t.Fatal(err)
		}
		if err = channel.Send(data); err != nil {
			t.Fatal(err)
		}
	}
	for offset := 0; offset < len(payload); {
		end := min(offset+chunkBytes, len(payload))
		method := ""
		idempotencyKey := ""
		if offset == 0 {
			method = "/transport/uppercase"
			idempotencyKey = "direct-config-control"
		}
		send(&runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_REQUEST, RequestId: 1, Method: method, IdempotencyKey: idempotencyKey, Payload: payload[offset:end], ChunkEnd: end == len(payload)})
		offset = end
	}
	var received []byte
	for {
		select {
		case frame := <-frames:
			if frame.Kind != runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_RESPONSE || frame.RequestId != 1 {
				t.Fatalf("unexpected frame %v", frame.Kind)
			}
			received = append(received, frame.Payload...)
			if frame.ChunkEnd {
				goto complete
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
complete:
	if !bytes.Equal(received, bytes.ToUpper(payload)) {
		t.Fatal("direct response fragments changed payload")
	}
	send(&runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_REQUEST, RequestId: 1, Method: "/transport/uppercase", ChunkEnd: true})
	select {
	case <-server.ctx.Done():
	case <-ctx.Done():
		t.Fatal("replay did not close the peer")
	}
	if dispatched.Load() != 1 {
		t.Fatal("request replay executed again")
	}
}

func TestDirectTransportRejectsRelayConfiguration(t *testing.T) {
	for _, value := range []string{"turn:relay.example:3478", "turns:relay.example:5349", "stun:user:pass@host:3478", "https://proxy.example"} {
		if stunURL(value) {
			t.Fatalf("accepted relay or credential locator %q", value)
		}
	}
	for _, value := range []string{"stun:stun.example:3478", "stuns:stun.example:5349", "stun:[::1]:3478"} {
		if !stunURL(value) {
			t.Fatalf("rejected STUN locator %q", value)
		}
	}
	if !relayCandidate("v=0\r\na=candidate:1 1 udp 100 192.0.2.1 1234 typ relay raddr 0.0.0.0 rport 0\r\n") {
		t.Fatal("relay candidate was not identified")
	}
	if relayCandidate("v=0\r\na=candidate:1 1 udp 100 192.0.2.1 1234 typ host\r\n") {
		t.Fatal("direct candidate was rejected")
	}
}

// Real Pion peers exercise streaming and multiplexing here. The dispatcher is
// a transport consumer, not a substitute for App authorization or storage tests.
func TestDirectPeerStreamsLargeInputBeforeEOFWithoutBlockingOtherCalls(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	api := loopbackPeerAPI()
	client, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := client.Close(); err != nil {
			t.Errorf("close peer connection: %v", err)
		}
	}()
	protocol := channelProtocol
	channel, err := client.CreateDataChannel(channelLabel, &webrtc.DataChannelInit{Protocol: &protocol})
	if err != nil {
		t.Fatal(err)
	}
	opened := make(chan struct{})
	channel.OnOpen(func() { close(opened) })
	frames := make(chan *runtimev1.RemoteTransportFrame, 16)
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		frame := &runtimev1.RemoteTransportFrame{}
		if proto.Unmarshal(message.Data, frame) == nil {
			select {
			case frames <- frame:
			case <-ctx.Done():
			}
		}
	})
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(client)
	if err := client.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var observed atomic.Int64
	assertLoopbackCandidates(t, client.LocalDescription().SDP)
	server, answer, err := newPeer(ctx, ctx, api, PeerInfo{Deadline: time.Now().Add(time.Minute), AccountInvalidated: make(chan struct{})}, client.LocalDescription().SDP, nil,
		func(ctx context.Context, _ *Peer, call Call, _ func([]byte) error) ([]byte, bool, error) {
			if call.Method == "/probe" {
				return []byte("available"), false, nil
			}
			if call.Input == nil || string(call.Payload) != "metadata" {
				return nil, false, errors.New("missing upload input")
			}
			for {
				payload, err := call.Input(ctx)
				if errors.Is(err, io.EOF) {
					return []byte(strconv.FormatInt(observed.Load(), 10)), false, nil
				}
				if err != nil {
					return nil, false, err
				}
				if bytes.Count(payload, []byte{0x5a}) != len(payload) {
					return nil, false, errors.New("input changed")
				}
				observed.Add(int64(len(payload)))
			}
		})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	assertLoopbackCandidates(t, answer)
	if err = client.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-opened:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	send := func(frame *runtimev1.RemoteTransportFrame) {
		t.Helper()
		data, err := proto.Marshal(frame)
		if err != nil {
			t.Fatal(err)
		}
		if err := channel.Send(data); err != nil {
			t.Fatal(err)
		}
	}
	receive := func() *runtimev1.RemoteTransportFrame {
		t.Helper()
		select {
		case frame := <-frames:
			return frame
		case <-ctx.Done():
			t.Fatal(ctx.Err())
			return nil
		}
	}
	send(&runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_OPEN, RequestId: 1, Method: "/upload", Payload: []byte("metadata"), ChunkEnd: true})
	credits := uint32(0)
	consumeCredit := func(frame *runtimev1.RemoteTransportFrame) {
		t.Helper()
		if frame.Kind != runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_CREDIT || frame.RequestId != 1 {
			t.Fatalf("unexpected frame: %v", frame)
		}
		credits += frame.InputCredits
		if credits > inputWindow {
			t.Fatal("unbounded owner window")
		}
	}
	part := bytes.Repeat([]byte{0x5a}, 256<<10)
	for message := 0; message < 140; message++ {
		for credits == 0 {
			consumeCredit(receive())
		}
		credits--
		for offset := 0; offset < len(part); offset += chunkBytes {
			end := min(offset+chunkBytes, len(part))
			send(&runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_DATA, RequestId: 1, Payload: part[offset:end], ChunkEnd: end == len(part)})
		}
		if message == 5 {
			if observed.Load() == 0 {
				t.Fatal("owner did not receive any data before EOF")
			}
			send(&runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_REQUEST, RequestId: 2, Method: "/probe", ChunkEnd: true})
			for {
				frame := receive()
				if frame.RequestId == 2 {
					if frame.Kind != runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_RESPONSE || string(frame.Payload) != "available" {
						t.Fatal(frame)
					}
					break
				}
				consumeCredit(frame)
			}
		}
	}
	send(&runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_END, RequestId: 1, ChunkEnd: true})
	for {
		frame := receive()
		if frame.Kind == runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_CREDIT {
			consumeCredit(frame)
			continue
		}
		if frame.Kind != runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_RESPONSE || frame.RequestId != 1 || string(frame.Payload) != strconv.Itoa(140*len(part)) {
			t.Fatal(frame)
		}
		break
	}
}

// In-process transport tests need real UDP, SCTP and DTLS but no LAN sockets
// or multicast discovery. Production supplies the ordinary Pion API above.
func loopbackPeerAPI() *webrtc.API {
	var settings webrtc.SettingEngine
	settings.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	settings.SetIncludeLoopbackCandidate(true)
	settings.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
	settings.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
	return webrtc.NewAPI(webrtc.WithSettingEngine(settings))
}

func assertLoopbackCandidates(t *testing.T, sdp string) {
	t.Helper()
	count := 0
	for _, line := range strings.Split(sdp, "\n") {
		if !strings.HasPrefix(line, "a=candidate:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 || !net.ParseIP(fields[4]).IsLoopback() {
			t.Fatalf("test gathered non-loopback candidate: %s", line)
		}
		count++
	}
	if count == 0 {
		t.Fatal("loopback transport has no actual candidate")
	}
}
