'use client';

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from 'uuid';
import { Video, VideoOff, Mic, MicOff, User, ArrowLeft, LogIn, AlertCircle } from 'lucide-react';

export default function RoomPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const roomId = params.roomId as string || uuidv4();
  const initialName = searchParams.get("name") || "";
  const initialCamera = searchParams.get("camera") === "true";
  const initialAudio = searchParams.get("audio") !== "false"; // default true

  const [name, setName] = useState(initialName);
  const [cameraOn, setCameraOn] = useState(initialCamera);
  const [audioOn, setAudioOn] = useState(initialAudio);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Error message auto-hide
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Camera effect
  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Error accessing camera:", err);
        setErrorMessage("Failed to access camera");
      }
    };

    if (cameraOn) {
      startCamera();
    } else {
      // Stop camera tracks if turned off
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [cameraOn]);

  // Microphone effect
  useEffect(() => {
    const startAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioStreamRef.current = stream;

        // Mute/unmute tracks based on audioOn
        stream.getAudioTracks().forEach(track => track.enabled = audioOn);
      } catch (err) {
        console.error("Error accessing microphone:", err);
        setErrorMessage("Failed to access microphone");
      }
    };

    if (audioOn) {
      if (!audioStreamRef.current) startAudio();
      else audioStreamRef.current.getAudioTracks().forEach(track => track.enabled = true);
    } else {
      audioStreamRef.current?.getAudioTracks().forEach(track => track.enabled = false);
    }

    return () => {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
      }
    };
  }, [audioOn]);

  const handleJoin = () => {
    if (!name.trim()) {
      setErrorMessage("Please enter your name");
      return;
    }

    // Navigate to meeting page with media state
    router.push(
      `/meeting/${roomId}?name=${encodeURIComponent(name)}&camera=${cameraOn}&audio=${audioOn}`
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl animate-pulse delay-500"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6">
        {/* Header */}
        <div className="w-full max-w-6xl mb-8">
          <button
            type="button"
            onClick={() => router.back()}
            className="group flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300"
          >
            <ArrowLeft className="w-4 h-4 group-hover:transform group-hover:-translate-x-1 transition-transform duration-300" />
            <span className="text-sm">Back</span>
          </button>
        </div>

        {/* Main Content */}
        <div className="w-full max-w-6xl">
          {/* Title */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-white via-purple-200 to-white bg-clip-text text-transparent mb-4">
              Join Meeting
            </h1>
            <div className="h-1 w-24 bg-gradient-to-r from-purple-500 to-blue-500 mx-auto rounded-full mb-6"></div>
            <p className="text-gray-300 text-lg">
              Room ID: <span className="text-purple-300 font-mono">{roomId}</span>
            </p>
          </div>

          {/* Name Input */}
          <div className="mb-10">
            <div className="max-w-md mx-auto">
              <label className="block text-sm font-medium text-gray-300 mb-3">
                <User className="inline w-4 h-4 mr-2" />
                Your Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-4 bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-white placeholder-gray-400 transition-all duration-300"
                  autoFocus
                />
              </div>
            </div>
          </div>

          {/* Camera & Audio Controls */}
          <div className="grid lg:grid-cols-3 gap-8 mb-10">
            {/* Camera Preview */}
            <div className="lg:col-span-2">
              <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center">
                <Video className="w-5 h-5 mr-2" />
                Camera Preview
              </h3>
              <div className="relative bg-white/5 backdrop-blur-sm border border-white/20 rounded-3xl overflow-hidden h-80 md:h-96">
                {cameraOn ? (
                  <>
                    <video ref={videoRef} autoPlay muted className="w-full h-full object-cover" />
                    <div className="absolute bottom-4 left-4 px-3 py-2 bg-black/50 backdrop-blur-sm rounded-xl border border-white/20">
                      <span className="text-sm text-green-300 flex items-center">
                        <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                        Camera On
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10 mb-4">
                      <VideoOff className="w-16 h-16" />
                    </div>
                    <p className="text-lg font-medium">Camera is off</p>
                    <p className="text-sm text-gray-500">Click "Turn On" to enable your camera</p>
                  </div>
                )}
              </div>
            </div>

            {/* Controls Panel */}
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center">
                <span className="w-2 h-2 bg-blue-400 rounded-full mr-3"></span>
                Meeting Settings
              </h3>

              {/* Audio Control */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {audioOn ? <Mic className="w-5 h-5 text-green-400" /> : <MicOff className="w-5 h-5 text-red-400" />}
                    <div>
                      <p className="font-medium">Microphone</p>
                      <p className="text-sm text-gray-400">Computer audio</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={audioOn}
                      onChange={() => setAudioOn(!audioOn)}
                      className="sr-only peer"
                    />
                    <div className="w-12 h-6 bg-gray-700 rounded-full peer peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-blue-500 transition-all duration-300"></div>
                    <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-6 transition-all duration-300 shadow-lg"></span>
                  </label>
                </div>
                <div className="text-xs text-gray-500">
                  {audioOn ? "Microphone will be enabled" : "Microphone will be muted"}
                </div>
              </div>

              {/* Camera Control */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {cameraOn ? <Video className="w-5 h-5 text-green-400" /> : <VideoOff className="w-5 h-5 text-red-400" />}
                    <div>
                      <p className="font-medium">Camera</p>
                      <p className="text-sm text-gray-400">Video feed</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCameraOn(!cameraOn)}
                    className={`px-4 py-2 rounded-xl font-medium transition-all duration-300 ${
                      cameraOn
                        ? "bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30"
                        : "bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30"
                    }`}
                  >
                    {cameraOn ? "Turn Off" : "Turn On"}
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  {cameraOn ? "Camera is active" : "Camera is disabled"}
                </div>
              </div>

              {/* Join Button */}
              <button
                onClick={handleJoin}
                className="w-full group relative px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl font-semibold hover:from-purple-500 hover:to-blue-500 transform hover:scale-105 hover:shadow-2xl hover:shadow-purple-500/25 transition-all duration-300"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <LogIn className="w-5 h-5" />
                  Join Meeting
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-blue-400 rounded-2xl blur opacity-0 group-hover:opacity-30 transition-opacity duration-300"></div>
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 px-6 py-4 bg-red-500/20 backdrop-blur-sm border border-red-500/30 rounded-2xl shadow-2xl animate-bounce">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="text-red-300 font-medium">{errorMessage}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
