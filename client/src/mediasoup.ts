import {
  type Transport,
  type Producer,
  type Consumer,
} from "mediasoup-client/types";
import { Device } from "mediasoup-client";

import { socket } from "./socket.io";

/*
|--------------------------------------------------------------------------
| Global mediasoup objects
|--------------------------------------------------------------------------
*/

let device: Device;

let sendTransport: Transport;

let recvTransport: Transport;

/*
|--------------------------------------------------------------------------
| Store our Producers
|--------------------------------------------------------------------------
*/

const producers = new Map<string, Producer>();

/*
|--------------------------------------------------------------------------
| Store our Consumers
|--------------------------------------------------------------------------
*/

const consumers = new Map<string, Consumer>();

/*
|--------------------------------------------------------------------------
| STEP 1
|
| Join the room and load the mediasoup Device
|--------------------------------------------------------------------------
*/

export async function joinRoom(roomId: string) {
  const result = await socket.emitWithAck("joinRoom", {
    roomId,
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  /*
  ------------------------------------------------------------
  Create mediasoup Device
  ------------------------------------------------------------
  */

  device = new Device();

  /*
  ------------------------------------------------------------
  Give Router capabilities to Device
  ------------------------------------------------------------
  */

  await device.load({
    routerRtpCapabilities: result.routerRtpCapabilities,
  });

  console.log("mediasoup Device loaded");

  /*
  ------------------------------------------------------------
  Create send transport
  ------------------------------------------------------------
  */

  await createSendTransport();

  /*
  ------------------------------------------------------------
  Create receive transport
  ------------------------------------------------------------
  */

  await createRecvTransport();

  /*
  ------------------------------------------------------------
  Get microphone + camera
  ------------------------------------------------------------
  */

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: true,
  });

  /*
  ------------------------------------------------------------
  Send audio + video to SFU
  ------------------------------------------------------------
  */

  await produceMedia(stream);

  /*
  ------------------------------------------------------------
  Receive Producers that already existed
  ------------------------------------------------------------
  */

  const existing = await socket.emitWithAck("getProducers");

  if (existing.success) {
    for (const producer of existing.producers) {
      await consumeProducer(producer.producerId);
    }
  }

  return stream;
}

/*
|--------------------------------------------------------------------------
| STEP 2
|
| Create SEND transport
|--------------------------------------------------------------------------
*/

async function createSendTransport() {
  const result = await socket.emitWithAck("createWebRtcTransport", {
    direction: "send",
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  sendTransport = device.createSendTransport(result.params);

  /*
  ------------------------------------------------------------
  Transport CONNECT event
  ------------------------------------------------------------
  */

  sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    try {
      const result = await socket.emitWithAck("connectTransport", {
        transportId: sendTransport.id,

        dtlsParameters,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      callback();
    } catch (error) {
      errback(
        error instanceof Error
          ? error
          : new Error("Transport connection failed"),
      );
    }
  });

  /*
  ------------------------------------------------------------
  Producer creation event
  ------------------------------------------------------------
  */

  sendTransport.on(
    "produce",
    async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const result = await socket.emitWithAck("produce", {
          transportId: sendTransport.id,

          kind,

          rtpParameters,

          appData,
        });

        if (!result.success) {
          throw new Error(result.error);
        }

        callback({
          id: result.id,
        });
      } catch (error) {
        errback(
          error instanceof Error
            ? error
            : new Error("Could not create producer"),
        );
      }
    },
  );
}

/*
|--------------------------------------------------------------------------
| STEP 3
|
| Create RECEIVE transport
|--------------------------------------------------------------------------
*/

async function createRecvTransport() {
  const result = await socket.emitWithAck("createWebRtcTransport", {
    direction: "recv",
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  recvTransport = device.createRecvTransport(result.params);

  /*
  ------------------------------------------------------------
  Receive transport connect event
  ------------------------------------------------------------
  */

  recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    try {
      const result = await socket.emitWithAck("connectTransport", {
        transportId: recvTransport.id,

        dtlsParameters,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      callback();
    } catch (error) {
      errback(
        error instanceof Error
          ? error
          : new Error("Receive transport connection failed"),
      );
    }
  });
}

/*
|--------------------------------------------------------------------------
| STEP 4
|
| Send camera and microphone
|--------------------------------------------------------------------------
*/

async function produceMedia(stream: MediaStream) {
  const videoTrack = stream.getVideoTracks()[0];

  const audioTrack = stream.getAudioTracks()[0];

  /*
  ------------------------------------------------------------
  Produce video
  ------------------------------------------------------------
  */

  if (videoTrack) {
    const producer = await sendTransport.produce({
      track: videoTrack,

      appData: {
        mediaType: "camera",
      },
    });

    producers.set(producer.id, producer);
  }

  /*
  ------------------------------------------------------------
  Produce audio
  ------------------------------------------------------------
  */

  if (audioTrack) {
    const producer = await sendTransport.produce({
      track: audioTrack,

      appData: {
        mediaType: "microphone",
      },
    });

    producers.set(producer.id, producer);
  }
}

/*
|--------------------------------------------------------------------------
| STEP 5
|
| Consume another user's Producer
|--------------------------------------------------------------------------
*/

export async function consumeProducer(producerId: string) {
  if (consumers.has(producerId)) {
    return;
  }

  const result = await socket.emitWithAck("consume", {
    producerId,

    rtpCapabilities: device.recvRtpCapabilities,
  });

  if (!result.success) {
    console.error("Could not consume producer:", result.error);

    return;
  }

  /*
  ------------------------------------------------------------
  Create local Consumer
  ------------------------------------------------------------
  */

  const consumer = await recvTransport.consume({
    id: result.params.id,

    producerId: result.params.producerId,

    kind: result.params.kind,

    rtpParameters: result.params.rtpParameters,
  });

  consumers.set(producerId, consumer);

  /*
  ------------------------------------------------------------
  Tell application that we received a track
  ------------------------------------------------------------
  */

  const event = new CustomEvent("remoteTrack", {
    detail: {
      producerId,
      consumer,
      track: consumer.track,
    },
  });

  window.dispatchEvent(event);

  /*
  ------------------------------------------------------------
  Resume server-side Consumer
  ------------------------------------------------------------
  */

  const resumeResult = await socket.emitWithAck("resumeConsumer", {
    consumerId: consumer.id,
  });

  if (!resumeResult.success) {
    console.error("Could not resume consumer:", resumeResult.error);
  }
}

/*
|--------------------------------------------------------------------------
| STEP 6
|
| Listen for new Producers
|--------------------------------------------------------------------------
*/

socket.on("newProducer", async ({ producerId }) => {
  console.log("new producer:", producerId);

  await consumeProducer(producerId);
});

/*
|--------------------------------------------------------------------------
| STEP 7
|
| Peer left
|--------------------------------------------------------------------------
*/

socket.on("peerLeft", ({ peerId }) => {
  console.log("peer left:", peerId);
});

/*
|--------------------------------------------------------------------------
| Get local producers
|--------------------------------------------------------------------------
*/

export function getProducers() {
  return producers;
}

/*
|--------------------------------------------------------------------------
| Close everything
|--------------------------------------------------------------------------
*/

export function closeMedia() {
  for (const producer of producers.values()) {
    producer.close();
  }

  for (const consumer of consumers.values()) {
    consumer.close();
  }

  sendTransport?.close();

  recvTransport?.close();
}
