import type { types } from "mediasoup";
import type { Peer, Room } from "./types";


export function createRoom(
  roomId: string,
  router: types.Router
): Room {
  return {
    id: roomId,
    router,
    peers: new Map()
  };
}

export function createPeer(
  socketId: string,
  roomId: string
): Peer {
  return {
    id: socketId,
    roomId,

    producers: new Map(),
    consumers: new Map()
  };
}