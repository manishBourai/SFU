import * as mediasoup from "mediasoup";

let worker: mediasoup.types.Worker;

export async function createWorker() {
  worker = await mediasoup.createWorker({
    logLevel: "warn"
  });

  console.log("mediasoup worker created");

  worker.on("died", () => {
    console.error("mediasoup worker died");

    setTimeout(() => {
      (globalThis as typeof globalThis & {
        process?: { exit: (code: number) => never };
      }).process?.exit(1);
    }, 2000);
  });

  return worker;
}

export async function createRouter() {
  if (!worker) {
    throw new Error("Worker has not been created");
  }

  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {}
      }
    ]
  });

  console.log("router created:", router.id);

  return router;
}

export async function createWebRtcTransport(
  router: mediasoup.types.Router
) {
  const transport = await router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: "udp",
        ip: "127.0.0.1"
      },
      {
        protocol: "tcp",
        ip: "127.0.0.1"
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  });

  console.log(
    "WebRTC transport created:",
    transport.id
  );

  return transport;
}