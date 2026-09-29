import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

import { createWorker, createRouter, createWebRtcTransport } from "./mediaSoup";

import { createRoom, createPeer } from "./room";

import type { Room, Peer } from "./types";

const app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
  },
});

/*
|--------------------------------------------------------------------------
| Application state
|--------------------------------------------------------------------------
|
| rooms
|
| roomId -> Room
|
| Each room contains:
|
| Router
| Peers
|
*/
const rooms = new Map<string, Room>();

/*
|--------------------------------------------------------------------------
| Helper: get or create room
|--------------------------------------------------------------------------
*/

async function getOrCreateRoom(roomId: string): Promise<Room> {
  const existingRoom = rooms.get(roomId);

  if (existingRoom) {
    return existingRoom;
  }

  const router = await createRouter();

  const room = createRoom(roomId, router);

  rooms.set(roomId, room);

  return room;
}

/*
|--------------------------------------------------------------------------
| Helper: find peer
|--------------------------------------------------------------------------
*/

function getPeer(socketId: string): Peer {
  for (const room of rooms.values()) {
    const peer = room.peers.get(socketId);

    if (peer) {
      return peer;
    }
  }

  throw new Error(`Peer not found: ${socketId}`);
}

/*
|--------------------------------------------------------------------------
| Helper: find transport
|--------------------------------------------------------------------------
*/

function getTransport(
  peer: Peer,
  transportId: string,
): ReturnType<typeof createWebRtcTransport> extends Promise<infer T>
  ? T
  : never {
  if (peer.sendTransport?.id === transportId) {
    return peer.sendTransport as any;
  }

  if (peer.recvTransport?.id === transportId) {
    return peer.recvTransport as any;
  }

  throw new Error(`Transport not found: ${transportId}`);
}

/*
|--------------------------------------------------------------------------
| Socket connection
|--------------------------------------------------------------------------
*/

io.on("connection", (socket) => {
  console.log("client connected:", socket.id);

  /*
  |--------------------------------------------------------------------------
  | JOIN ROOM
  |--------------------------------------------------------------------------
  */

  socket.on("joinRoom", async ({ roomId }: { roomId: string }, callback) => {
    try {
      const room = await getOrCreateRoom(roomId);

      const peer = createPeer(socket.id, roomId);

      room.peers.set(socket.id, peer);

      socket.join(roomId);

      console.log(`${socket.id} joined ${roomId}`);

      callback({
        success: true,

        routerRtpCapabilities: room.router.rtpCapabilities,
      });
    } catch (error) {
      console.error(error);

      callback({
        success: false,
        error: "Could not join room",
      });
    }
  });

  /*
  |--------------------------------------------------------------------------
  | CREATE WEBRTC TRANSPORT
  |--------------------------------------------------------------------------
  */

  socket.on("createWebRtcTransport", async ( { direction, }: {  direction: "send" | "recv";  },  callback,) => {
      try {
        const peer = getPeer(socket.id);

        const room = rooms.get(peer.roomId);

        if (!room) {
          throw new Error("Room not found");
        }

        const transport = await createWebRtcTransport(room.router);

        /*
        ------------------------------------------------------------
        Save transport inside the peer
        ------------------------------------------------------------
        */

        if (direction === "send") {
          peer.sendTransport = transport;
        } else {
          peer.recvTransport = transport;
        }

        /*
        ------------------------------------------------------------
        Tell browser how to connect
        ------------------------------------------------------------
        */

        callback({
          success: true,

          params: {
            id: transport.id,

            iceParameters: transport.iceParameters,

            iceCandidates: transport.iceCandidates,

            dtlsParameters: transport.dtlsParameters,
          },
        });
      } catch (error) {
        console.error(error);

        callback({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Transport creation failed",
        });
      }
    },
  );

  /*
  |--------------------------------------------------------------------------
  | CONNECT WEBRTC TRANSPORT
  |--------------------------------------------------------------------------
  */

  socket.on(
    "connectTransport",
    async ({ transportId, dtlsParameters }, callback) => {
      try {
        const peer = getPeer(socket.id);

        const transport = getTransport(peer, transportId);

        await transport.connect({
          dtlsParameters,
        });

        callback({
          success: true,
        });
      } catch (error) {
        console.error(error);

        callback({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Transport connection failed",
        });
      }
    },
  );

  /*
  |--------------------------------------------------------------------------
  | PRODUCE
  |--------------------------------------------------------------------------
  */

  socket.on(
    "produce",
    async ({ transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const peer = getPeer(socket.id);

        const transport = getTransport(peer, transportId);

        const producer = await transport.produce({
          kind,
          rtpParameters,
          appData,
        });

        /*
        ------------------------------------------------------------
        Save Producer
        ------------------------------------------------------------
        */

        peer.producers.set(producer.id, producer);

        /*
        ------------------------------------------------------------
        Tell other users:
        "This peer has a new Producer."
        ------------------------------------------------------------
        */

        socket.to(peer.roomId).emit("newProducer", {
          producerId: producer.id,

          peerId: peer.id,

          kind: producer.kind,
        });

        /*
        ------------------------------------------------------------
        Tell browser the Producer was created
        ------------------------------------------------------------
        */

        callback({
          success: true,
          id: producer.id,
        });
      } catch (error) {
        console.error(error);

        callback({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not create producer",
        });
      }
    },
  );

  /*
  |--------------------------------------------------------------------------
  | GET EXISTING PRODUCERS
  |--------------------------------------------------------------------------
  */

  socket.on("getProducers", (callback) => {
    try {
      const peer = getPeer(socket.id);

      const producers: {
        producerId: string;
        peerId: string;
        kind: string;
      }[] = [];

      const room = rooms.get(peer.roomId);

      if (!room) {
        throw new Error("Room not found");
      }

      /*
        ------------------------------------------------------------
        Find Producers belonging to OTHER users
        ------------------------------------------------------------
        */

      for (const [peerId, otherPeer] of room.peers) {
        if (peerId === peer.id) {
          continue;
        }

        for (const producer of otherPeer.producers.values()) {
          producers.push({
            producerId: producer.id,

            peerId,

            kind: producer.kind,
          });
        }
      }

      callback({
        success: true,
        producers,
      });
    } catch (error) {
      callback({
        success: false,
        producers: [],
      });
    }
  });

  /*
  |--------------------------------------------------------------------------
  | CONSUME
  |--------------------------------------------------------------------------
  */

  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    try {
      const peer = getPeer(socket.id);

      const room = rooms.get(peer.roomId);

      if (!room) {
        throw new Error("Room not found");
      }

      const recvTransport = peer.recvTransport;

      if (!recvTransport) {
        throw new Error("Receive transport does not exist");
      }

      /*
        ------------------------------------------------------------
        Check whether this browser can understand
        the Producer's media.
        ------------------------------------------------------------
        */

      const canConsume = room.router.canConsume({
        producerId,
        rtpCapabilities,
      });

      if (!canConsume) {
        throw new Error("Browser cannot consume this producer");
      }

      /*
        ------------------------------------------------------------
        Create server-side Consumer
        ------------------------------------------------------------
        */

      const consumer = await recvTransport.consume({
        producerId,

        rtpCapabilities,

        paused: true,
      });

      /*
        ------------------------------------------------------------
        Save Consumer
        ------------------------------------------------------------
        */

      peer.consumers.set(consumer.id, consumer);

      /*
        ------------------------------------------------------------
        Tell browser how to create its
        local Consumer.
        ------------------------------------------------------------
        */

      callback({
        success: true,

        params: {
          id: consumer.id,

          producerId: consumer.producerId,

          kind: consumer.kind,

          rtpParameters: consumer.rtpParameters,
        },
      });
    } catch (error) {
      console.error(error);

      callback({
        success: false,

        error:
          error instanceof Error ? error.message : "Could not create consumer",
      });
    }
  });

  /*
  |--------------------------------------------------------------------------
  | RESUME CONSUMER
  |--------------------------------------------------------------------------
  */

  socket.on("resumeConsumer", async ({ consumerId }, callback) => {
    try {
      const peer = getPeer(socket.id);

      const consumer = peer.consumers.get(consumerId);

      if (!consumer) {
        throw new Error("Consumer not found");
      }

      await consumer.resume();

      callback({
        success: true,
      });
    } catch (error) {
      console.error(error);

      callback({
        success: false,

        error:
          error instanceof Error ? error.message : "Could not resume consumer",
      });
    }
  });

  /*
  |--------------------------------------------------------------------------
  | DISCONNECT
  |--------------------------------------------------------------------------
  */

  socket.on("disconnect", () => {
    console.log("client disconnected:", socket.id);

    for (const [roomId, room] of rooms) {
      const peer = room.peers.get(socket.id);

      if (!peer) {
        continue;
      }

      /*
        ------------------------------------------------------------
        Close Producers
        ------------------------------------------------------------
        */

      for (const producer of peer.producers.values()) {
        producer.close();
      }

      /*
        ------------------------------------------------------------
        Close Consumers
        ------------------------------------------------------------
        */

      for (const consumer of peer.consumers.values()) {
        consumer.close();
      }

      /*
        ------------------------------------------------------------
        Close Transports
        ------------------------------------------------------------
        */

      peer.sendTransport?.close();

      peer.recvTransport?.close();

      /*
        ------------------------------------------------------------
        Remove peer from room
        ------------------------------------------------------------
        */

      room.peers.delete(socket.id);

      /*
        ------------------------------------------------------------
        Tell remaining users
        ------------------------------------------------------------
        */

      socket.to(roomId).emit("peerLeft", {
        peerId: socket.id,
      });

      /*
        ------------------------------------------------------------
        If room is empty, remove it.
        ------------------------------------------------------------
        */

      if (room.peers.size === 0) {
        room.router.close();

        rooms.delete(roomId);

        console.log(`room ${roomId} closed`);
      }

      break;
    }
  });
});

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

async function start() {
  await createWorker();

  httpServer.listen(3000, () => {
    console.log("Server running at http://localhost:3000");
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);

  process.exit(1);
});
