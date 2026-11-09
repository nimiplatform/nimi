import { RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import type { RuntimeDataChannel, RuntimePeerConnection, RuntimePeerFactory } from '@nimiplatform/sdk/runtime';

/** Native Android/iOS DataChannel carrier. The SDK retains signaling, framing,
 * identity, permissions and request semantics; this adapter owns only WebRTC. */
export const createReactNativeRuntimePeer: RuntimePeerFactory = (stunUrls): RuntimePeerConnection => {
  const peer = new RTCPeerConnection({ iceServers: stunUrls.length ? [{ urls: [...stunUrls] }] : [], iceTransportPolicy: 'all' });
  return {
    get localDescription() { const description = peer.localDescription;
      return description?.type && description.sdp ? { type: description.type, sdp: description.sdp } : null; },
    get iceGatheringState() { return peer.iceGatheringState; },
    get connectionState() { return peer.connectionState; },
    createDataChannel(): RuntimeDataChannel {
      const channel = peer.createDataChannel('nimi-runtime-v1', { ordered: true, protocol: 'nimi-runtime-protobuf-v1' });
      channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 256 * 1024;
      return {
        get readyState() { return channel.readyState; },
        get bufferedAmount() { return channel.bufferedAmount; },
        send: bytes => channel.send(bytes), close: () => channel.close(),
        onOpen: listener => { channel.addEventListener('open', listener); return () => channel.removeEventListener('open', listener); },
        onClose: listener => { channel.addEventListener('close', listener); return () => channel.removeEventListener('close', listener); },
        onBufferLow: listener => { channel.addEventListener('bufferedamountlow', listener); return () => channel.removeEventListener('bufferedamountlow', listener); },
        onMessage: listener => {
          const receive = (event: { data: unknown }) => { if (event.data instanceof ArrayBuffer) listener(new Uint8Array(event.data)); else channel.close(); };
          channel.addEventListener('message', receive); return () => channel.removeEventListener('message', receive);
        },
      };
    },
    createOffer: async () => { const offer = await peer.createOffer({}); if (!offer.sdp) throw new Error('Native WebRTC returned no offer.'); return { type: 'offer', sdp: offer.sdp }; },
    setLocalDescription: async description => { await peer.setLocalDescription(new RTCSessionDescription(description)); },
    setRemoteDescription: async description => { await peer.setRemoteDescription(new RTCSessionDescription(description)); },
    onGatheringChange: listener => { peer.addEventListener('icegatheringstatechange', listener); return () => peer.removeEventListener('icegatheringstatechange', listener); },
    onConnectionChange: listener => { peer.addEventListener('connectionstatechange', listener); return () => peer.removeEventListener('connectionstatechange', listener); },
    close: () => peer.close(),
  };
};
