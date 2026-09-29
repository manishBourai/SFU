import { useEffect, useRef, useState } from "react";

import { joinRoom, closeMedia } from "./mediasoup";

type RemoteVideo = {
  producerId: string;
  stream: MediaStream;
};

export default function App() {
  const localVideoRef = useRef<HTMLVideoElement|null>(null);

  const [roomId, setRoomId] = useState("room-1");

  const [joined, setJoined] = useState(false);

  const [remoteVideos, setRemoteVideos] = useState<RemoteVideo[]>([]);


  //    const stream = await navigator.mediaDevices.getUserMedia({
  //   audio: true,
  //   video: true,
  // });

  //   localVideoRef.current!.srcObject = stream;

  async function handleJoin() {
    try {
      const stream: MediaStream = await joinRoom(roomId);

      // /*
      // ------------------------------------------------------------
      // Show our own camera
      // ------------------------------------------------------------
      // */
      // const localVideo = localVideoRef.current;

      // if (!localVideo) {
      //   throw new Error("Local video element not found");
      // }

      // localVideo.srcObject = stream;

      // // await localVideo.play().catch((error: any) => {
      // //   console.error("Error playing local video:", error);
      // });

      setJoined(true);
    } catch (error) {
      console.error(error);

      alert(error instanceof Error ? error.message : "Could not join room");
    }
  }
  const localVideoSet= async()=>{
    
          const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

        localVideoRef.current!.srcObject = stream;
  }

  useEffect(() => {
    /*
    ------------------------------------------------------------
    Listen for tracks coming from mediasoup
    ------------------------------------------------------------
    */
    localVideoSet();

    const handleRemoteTrack = (event: Event) => {
      const customEvent = event as CustomEvent;

      const { producerId, track } = customEvent.detail;

      const stream = new MediaStream([track]);

      setRemoteVideos((current) => {
        /*
            Don't add the same Producer twice.
            */

        const alreadyExists = current.some(
          (item) => item.producerId === producerId,
        );

        if (alreadyExists) {
          return current;
        }

        return [
          ...current,
          {
            producerId,
            stream,
          },
        ];
      });
    };

    window.addEventListener("remoteTrack", handleRemoteTrack);

    return () => {
      window.removeEventListener("remoteTrack", handleRemoteTrack);

      closeMedia();
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "30px",
        fontFamily: "Arial",
      }}
    >
      <h1>Mediasoup SFU</h1>

      {!joined && (
        <div>
          <input
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            placeholder="Room ID"
            style={{
              padding: "10px",
              marginRight: "10px",
            }}
          />

          <button
            onClick={handleJoin}
            style={{
              padding: "10px 20px",
            }}
          >
            Join Room
          </button>
        </div>
      )}

 
        <div>
          <h2>Room: {roomId}</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            <div>
              <h3>You</h3>

              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: "100%",
                  background: "black",
                  borderRadius: "10px",
                  // height: "300px",
                }}
              />
            </div>

            {remoteVideos.map(({ producerId, stream }) => (
              <RemoteVideo key={producerId} stream={stream} />
            ))}
          </div>
        </div>
      
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| Remote video component
|--------------------------------------------------------------------------
*/

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div>
      <h3>Remote Participant</h3>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: "100%",
          background: "black",
          borderRadius: "10px",
        }}
      />
    </div>
  );
}
