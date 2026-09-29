import type { types } from "mediasoup";

export type Peer = {
  id: string;
  roomId: string;

  sendTransport?: types.WebRtcTransport;
  recvTransport?: types.WebRtcTransport;

  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;

  rtpCapabilities?: types.RtpCapabilities;
};

export type Room = {
  id: string;
  router: types.Router;

  peers: Map<string, Peer>;
};