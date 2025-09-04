'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Mic, MicOff, Video, VideoOff, MessageSquare, Copy, PhoneOff, Monitor, MonitorOff, Clock, Users } from 'lucide-react';

const SOCKET_SERVER_URL = 'http://localhost:3001';

const mediaConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: { sampleRate: 44100, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
};

const screenConstraints = {
  video: { cursor: "always", width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30 } },
  audio: false
};

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

interface ChatMessage {
  name: string;
  message: string;
  timestamp: number;
}

interface Participant {
  id: string;
  name: string;
  stream: MediaStream | null;
  cameraStream?: MediaStream | null;
  screenStream?: MediaStream | null;
  cameraOn: boolean;
  audioOn: boolean;
  screenShareOn: boolean;
}

const formatTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hrs > 0
    ? `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
};

export default function MeetingPage() {
  // State
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('Guest');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [screenShareOn, setScreenShareOn] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meetingTime, setMeetingTime] = useState(0);

  // Refs
  const socketRef = useRef<any>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement>>({});
  const pendingCandidates = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const meetingStartRef = useRef<number>(0);
  const originalStreamRef = useRef<MediaStream | null>(null);

  // Check if anyone is screen sharing
  const isAnyoneScreenSharing = participants.some(p => p.screenShareOn);

  // Get the screen sharer (prioritize first screen sharer, including local user)
  const screenSharer = participants.find(p => p.screenShareOn);

  // Get other participants (excluding screen sharer if any, but keep local user visible)
  const otherParticipants = participants.filter(p => 
    !isAnyoneScreenSharing || p.id !== screenSharer?.id || p.id === 'local'
  );

  // Initialize media stream
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      originalStreamRef.current = stream;

      // Create disabled stream (start muted/camera-off)
      const disabledStream = new MediaStream();
      stream.getTracks().forEach(track => {
        track.enabled = false;
        disabledStream.addTrack(track);
      });

      setLocalStream(disabledStream);
      return disabledStream;
    } catch (err) {
      console.error('Media access error:', err);
      setError('Could not access camera or microphone. Please check permissions.');
      return null;
    }
  }, []);

  // FIXED: Enhanced peer connection creation with better track management
  const createPeerConnection = useCallback((userId: string, isExistingUser = false) => {
    console.log(`Creating peer connection for ${userId} (existing: ${isExistingUser})`);
    
    const pc = new RTCPeerConnection({ iceServers });
    peerConnectionsRef.current[userId] = pc;

    // Add camera tracks first
    if (localStream) {
      localStream.getTracks().forEach(track => {
        try { 
          pc.addTrack(track, localStream); 
          console.log(`Added camera track to peer ${userId}:`, track.kind);
        } catch (e) { 
          console.warn('Failed to add camera track:', e);
        }
      });
    }

    // Add screen tracks if actively sharing
    if (screenStream && screenShareOn) {
      screenStream.getTracks().forEach(track => {
        try { 
          pc.addTrack(track, screenStream);
          console.log(`Added screen share track to peer ${userId}:`, track.kind);
        } catch (e) { 
          console.warn('Failed to add screen track:', e);
        }
      });
    }

    pc.ontrack = (event) => {
      console.log(`Received track from ${userId}:`, event.track.kind, event.streams.length);
      
      event.streams.forEach((stream, streamIndex) => {
        const videoTrack = stream.getVideoTracks()[0];
        const hasVideo = !!videoTrack;
        const hasAudio = stream.getAudioTracks().length > 0;
        
        // Better screen share detection
        const isScreenShare = hasVideo && (
          videoTrack.label.includes('screen') ||
          videoTrack.label.includes('window') ||
          videoTrack.label.includes('tab') ||
          // Check constraints for screen share characteristics
          (videoTrack.getSettings && (() => {
            const settings = videoTrack.getSettings() as any;
            return settings.width > 1920 || settings.height > 1080 ||
                   settings.displaySurface === 'monitor' ||
                   settings.displaySurface === 'window' ||
                   settings.displaySurface === 'application';
          })()) ||
          // If it's a single video track without audio, likely screen share
          (stream.getTracks().length === 1 && videoTrack.kind === 'video')
        );

        console.log(`Stream ${streamIndex} from ${userId} - Video: ${hasVideo}, Audio: ${hasAudio}, IsScreenShare: ${isScreenShare}`);

        setParticipants(prev =>
          prev.map(p => {
            if (p.id === userId) {
              const updatedP = { ...p };
              if (isScreenShare) {
                updatedP.screenStream = stream;
                console.log(`Set screen stream for ${userId}`);
              } else {
                updatedP.cameraStream = stream;
                console.log(`Set camera stream for ${userId}`);
              }
              return updatedP;
            }
            return p;
          })
        );
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', { candidate: event.candidate, to: userId });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Peer connection with ${userId} state:`, pc.connectionState);
    };

    return pc;
  }, [localStream, screenStream, screenShareOn]);

  // Meeting timer
  useEffect(() => {
    if (participants.length > 0 && meetingStartRef.current === 0) {
      meetingStartRef.current = Date.now();
      const timer = setInterval(() => {
        setMeetingTime(Math.floor((Date.now() - meetingStartRef.current) / 1000));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [participants.length]);

  // Initialize on mount
  useEffect(() => {
    const pathSegments = window.location.pathname.split('/');
    setRoomId(pathSegments[pathSegments.length - 1]);
    setName(new URLSearchParams(window.location.search).get('name') || 'Guest');
    initializeMedia();

    return () => {
      originalStreamRef.current?.getTracks().forEach(track => track.stop());
      localStream?.getTracks().forEach(track => track.stop());
      screenStream?.getTracks().forEach(track => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializeMedia]);

  // Update local participant
  useEffect(() => {
    if (!localStream) return;

    setParticipants(prev => {
      const localParticipant: Participant = {
        id: 'local',
        name,
        stream: localStream,
        cameraStream: localStream,
        screenStream: screenStream,
        cameraOn,
        audioOn,
        screenShareOn
      };
      const existing = prev.find(p => p.id === 'local');
      return existing
        ? prev.map(p => p.id === 'local' ? localParticipant : p)
        : [localParticipant, ...prev];
    });
  }, [localStream, screenStream, name, cameraOn, audioOn, screenShareOn]);

  // FIXED: Enhanced socket setup with proper screen share initialization
  useEffect(() => {
    if (!localStream || !roomId) return;

    const socket = io(SOCKET_SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId, name, cameraOn, audioOn, screenShareOn });
    });

    // Handle chat message (new messages)
    socket.on('chat-message', (msg: ChatMessage) => {
      setChat(prev => [...prev, { ...msg, timestamp: msg.timestamp || Date.now() }]);
    });

    // Handle chat history restoration
    socket.on('chat-history', (chatHistory: ChatMessage[]) => {
      console.log('📧 Received chat history:', chatHistory.length, 'messages');
      setChat(chatHistory.map(msg => ({
        ...msg,
        timestamp: msg.timestamp || Date.now()
      })));
    });

    // FIXED: Handle existing users with proper screen share status
    socket.on('existing-users', ({ users, roomUserStatus }) => {
      console.log('Existing users:', users, 'Status:', roomUserStatus);
      
      users.forEach((user: any) => {
        const status = roomUserStatus[user.id] || {};
        
        // Add participant with current status INCLUDING screen share
        setParticipants(prev => {
          const exists = prev.find(p => p.id === user.id);
          if (!exists) {
            return [...prev, { 
              id: user.id, 
              name: user.name, 
              stream: null, 
              cameraStream: null,
              screenStream: null,
              cameraOn: status.cameraOn || false,
              audioOn: status.audioOn || false,
              screenShareOn: status.screenShareOn || false // CRITICAL: Include screen share status
            }];
          }
          return prev;
        });

        // Create peer connection and make offer - mark as existing user
        const pc = createPeerConnection(user.id, true);
        
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => socket.emit('offer', {
            sdp: pc.localDescription, 
            to: user.id, 
            name, 
            cameraOn, 
            audioOn, 
            screenShareOn // Include our screen share status in offer
          }))
          .catch(err => console.error('Error creating offer for', user.id, err));
      });
    });

    // Handle new user joining - they should see current screen share state
    socket.on('user-joined', ({ userId, name: userName, cameraOn: rCam, audioOn: rAudio, screenShareOn: rScreen }) => {
      console.log(`User ${userName} joined - they should see screen share: ${screenShareOn}`);
      
      setParticipants(prev => {
        const exists = prev.find(p => p.id === userId);
        return exists ? prev : [...prev, {
          id: userId, 
          name: userName, 
          stream: null,
          cameraStream: null,
          screenStream: null,
          cameraOn: rCam, 
          audioOn: rAudio, 
          screenShareOn: rScreen
        }];
      });
      
      // Create peer connection for new user - they're new so existing=false
      createPeerConnection(userId, false);
    });

    // FIXED: Enhanced offer handling with immediate screen share status update
    socket.on('offer', async ({ sdp, from, name: remoteName, cameraOn: rCam, audioOn: rAudio, screenShareOn: rScreen }) => {
      console.log(`Received offer from ${remoteName} with screen share: ${rScreen}`);
      
      // CRITICAL: Update participant status BEFORE creating connection
      setParticipants(prev =>
        prev.map(p => p.id === from ? { 
          ...p, 
          name: remoteName, // Update name in case it changed
          cameraOn: rCam, 
          audioOn: rAudio, 
          screenShareOn: rScreen 
        } : p)
      );

      const pc = createPeerConnection(from, true);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      // Include our current status in the answer
      socket.emit('answer', { 
        sdp: pc.localDescription, 
        to: from,
        name,
        cameraOn,
        audioOn,
        screenShareOn 
      });

      if (pendingCandidates.current[from]) {
        for (const candidate of pendingCandidates.current[from]) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        delete pendingCandidates.current[from];
      }
    });

    // FIXED: Enhanced answer handling
    socket.on('answer', async ({ sdp, from, name: remoteName, cameraOn: rCam, audioOn: rAudio, screenShareOn: rScreen }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        console.log(`Received answer from ${remoteName || from} with screen share: ${rScreen}`);
        
        // Update status from answer if provided
        if (remoteName !== undefined) {
          setParticipants(prev =>
            prev.map(p => p.id === from ? { 
              ...p,
              name: remoteName,
              cameraOn: rCam !== undefined ? rCam : p.cameraOn,
              audioOn: rAudio !== undefined ? rAudio : p.audioOn,
              screenShareOn: rScreen !== undefined ? rScreen : p.screenShareOn
            } : p)
          );
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        if (pendingCandidates.current[from]) {
          for (const candidate of pendingCandidates.current[from]) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          delete pendingCandidates.current[from];
        }
      }
    });

    socket.on('ice-candidate', async ({ candidate, from }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          if (!pendingCandidates.current[from]) pendingCandidates.current[from] = [];
          pendingCandidates.current[from].push(candidate);
        }
      }
    });

    socket.on('media-status-change', ({ userId, cameraOn: c, audioOn: a, screenShareOn: s }) => {
      console.log(`Media status change for ${userId}: camera=${c}, audio=${a}, screen=${s}`);
      setParticipants(prev =>
        prev.map(p => p.id === userId ? { ...p, cameraOn: c, audioOn: a, screenShareOn: s } : p)
      );
    });

    socket.on('user-left', (userId) => {
      setParticipants(prev => prev.filter(p => p.id !== userId));
      peerConnectionsRef.current[userId]?.close();
      delete peerConnectionsRef.current[userId];
    });

    // Handle server events for better UX
    socket.on('error', ({ message }) => {
      console.error('Server error:', message);
      setError(message);
      setTimeout(() => setError(null), 5000);
    });

    socket.on('room-disposed', ({ message }) => {
      console.warn('Room disposed:', message);
      setError(message);
    });

    socket.on('server-shutdown', ({ message }) => {
      console.warn('Server shutdown:', message);
      setError(message);
    });

    const pingInterval = setInterval(() => {
      const start = Date.now();
      socket.emit('ping-from-client');
      socket.once('pong-from-server', () => setLatency(Date.now() - start));
    }, 3000);

    return () => {
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      socket.disconnect();
      clearInterval(pingInterval);
    };
  }, [roomId, name, localStream, screenStream, cameraOn, audioOn, screenShareOn, createPeerConnection]);

  // Update media tracks
  useEffect(() => {
    if (!localStream) return;

    localStream.getAudioTracks().forEach(track => track.enabled = audioOn);
    localStream.getVideoTracks().forEach(track => track.enabled = cameraOn);

    socketRef.current?.emit('media-status-change', { cameraOn, audioOn, screenShareOn });
  }, [cameraOn, audioOn, screenShareOn, localStream]);

  // Control functions
  const toggleMic = useCallback(() => setAudioOn(prev => !prev), []);
  const toggleVideo = useCallback(() => setCameraOn(prev => !prev), []);

  // FIXED: Enhanced screen share with proper track management for ALL peers
  const toggleScreenShare = useCallback(async () => {
    try {
      // Stop current screen share
      if (screenShareOn && screenStream) {
        console.log('Stopping screen share...');
        screenStream.getTracks().forEach(track => track.stop());
        setScreenStream(null);
        setScreenShareOn(false);

        // Remove screen share tracks from all existing peer connections
        Object.entries(peerConnectionsRef.current).forEach(([userId, pc]) => {
          pc.getSenders().forEach(sender => {
            if (sender.track && screenStream.getTracks().includes(sender.track)) {
              try { 
                pc.removeTrack(sender);
                console.log(`Removed screen share track from peer ${userId}`);
              } catch (e) {
                console.warn(`Failed to remove screen share track from peer ${userId}:`, e);
              }
            }
          });
        });

        return;
      }

      // Request display media
      console.log('Starting screen share...');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      // Stop sharing when user clicks "Stop sharing"
      stream.getVideoTracks()[0].onended = () => {
        console.log('Screen share ended by user');
        setScreenShareOn(false);
        setScreenStream(null);
      };

      // Update state first
      setScreenStream(stream);
      setScreenShareOn(true);

      console.log('Screen share started, adding tracks to existing peers...');

      // Add screen share tracks to ALL existing peer connections
      Object.entries(peerConnectionsRef.current).forEach(([userId, pc]) => {
        stream.getTracks().forEach(track => {
          try { 
            pc.addTrack(track, stream);
            console.log(`Added screen share track to peer ${userId}`);
          } catch (e) {
            console.warn(`Failed to add screen share track to peer ${userId}:`, e);
            // If addTrack fails, try to renegotiate
            try {
              pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                  socketRef.current?.emit('offer', {
                    sdp: pc.localDescription,
                    to: userId,
                    name,
                    cameraOn,
                    audioOn,
                    screenShareOn: true // Important: set to true
                  });
                });
            } catch (renegotiateError) {
              console.error(`Failed to renegotiate with peer ${userId}:`, renegotiateError);
            }
          }
        });
      });

    } catch (err) {
      console.error("Screen share error:", err);
      setError("Failed to share screen. Make sure you allow window/full screen selection.");
      setScreenShareOn(false);
    }
  }, [screenShareOn, screenStream, name, cameraOn, audioOn]);

  const sendMessage = useCallback(() => {
    if (!message.trim() || !socketRef.current) return;
    socketRef.current.emit('chat-message', { roomId, message, name });
    setMessage('');
  }, [message, name, roomId]);

  const leaveMeeting = useCallback(() => {
    originalStreamRef.current?.getTracks().forEach(track => track.stop());
    localStream?.getTracks().forEach(track => track.stop());
    screenStream?.getTracks().forEach(track => track.stop());
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    socketRef.current?.disconnect();
    window.location.href = '/';
  }, [localStream, screenStream]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }, [roomId]);

  // Auto scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  // Remote audio setup
  useEffect(() => {
    participants.forEach(p => {
      if (p.cameraStream && audioRefs.current[p.id]) {
        audioRefs.current[p.id].srcObject = p.cameraStream;
      }
    });
  }, [participants]);

  const renderParticipant = (p: Participant, isSmallView = false) => {
    const hasCameraVideo = !!(p.cameraStream && p.cameraOn && p.cameraStream.getVideoTracks().length > 0);
    const hasScreenVideo = !!(p.screenStream && p.screenShareOn && p.screenStream.getVideoTracks().length > 0);

    // Use a single video tag, prioritizing screen share if available
    const mainStream = hasScreenVideo ? p.screenStream : hasCameraVideo ? p.cameraStream : null;
    const isScreenShareMain = hasScreenVideo;
    const isLocal = p.id === 'local';

    return (
      <div className={`w-full h-full relative bg-black/20 ${isSmallView ? 'rounded-lg overflow-hidden' : ''}`}>
        {mainStream ? (
          <video
            autoPlay
            muted={isLocal}
            playsInline
            className={`w-full h-full ${isScreenShareMain ? 'object-contain' : 'object-cover'} ${isLocal && !isScreenShareMain ? 'scale-x-[-1]' : ''}`}
            ref={(el) => {
              if (el) {
                videoRefs.current[p.id] = el;
                try { el.srcObject = mainStream; } catch (e) { /* ignore */ }
              }
            }}
          />
        ) : (
          <div
            className={`w-full h-full flex items-center justify-center ${isSmallView ? 'text-xl' : 'text-3xl'} font-bold text-white`}
            style={{ background: `linear-gradient(135deg, ${stringToColor(p.name)}, rgba(0,0,0,0.15))` }}
          >
            {p.name[0].toUpperCase()}
          </div>
        )}

        {/* Display camera stream as Picture-in-Picture if screen is main */}
        {isScreenShareMain && hasCameraVideo && !isSmallView && (
          <div className="absolute top-4 right-4 w-32 h-24 rounded-lg overflow-hidden border-2 border-white/10 shadow-lg">
            <video
              autoPlay
              muted={isLocal}
              playsInline
              className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
              ref={(el) => {
                if (el) {
                  videoRefs.current[`${p.id}-camera`] = el;
                  try { el.srcObject = p.cameraStream; } catch (e) { /* ignore */ }
                }
              }}
            />
          </div>
        )}

        {p.id !== 'local' && p.cameraStream && (
          <audio autoPlay ref={(el) => el && (audioRefs.current[p.id] = el)} className="hidden" />
        )}

        {/* Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
          <div className="flex items-center justify-between">
            <span className={`${isSmallView ? 'text-xs' : 'text-sm'} font-medium truncate`}>
              <span className={isLocal ? 'text-purple-200' : 'text-white'}>{p.name}</span>
              {isLocal && <span className="text-xs text-gray-300 ml-1">(You)</span>}
              {!isSmallView && (
                <span className="text-xs text-gray-400 ml-2">
                  {p.screenShareOn && p.cameraOn && '• Camera + Screen'}
                  {p.screenShareOn && !p.cameraOn && '• Screen'}
                  {!p.screenShareOn && p.cameraOn && '• Camera'}
                </span>
              )}
            </span>
            <div className="flex items-center space-x-1">
              {!p.audioOn && <MicOff className="text-red-400" size={isSmallView ? 12 : 16} />}
              {!p.cameraOn && !p.screenShareOn && <VideoOff className="text-red-400" size={isSmallView ? 12 : 16} />}
              {p.screenShareOn && <Monitor className="text-green-300" size={isSmallView ? 12 : 16} />}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-y-hidden overflow-x-hidden">
      {/* Subtle animated background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-48 -left-48 w-80 h-80 bg-blue-500/12 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between p-4 bg-white/5 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Clock className="text-purple-300" size={20} />
            <span className="font-mono text-lg font-semibold">{formatTime(meetingTime)}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Users className="text-blue-300" size={20} />
            <span className="text-sm">{participants.length} participant{participants.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-semibold bg-gradient-to-r from-purple-200 to-blue-200 bg-clip-text text-transparent">
            Meeting: {roomId}
          </h1>
          {latency !== null && (
            <div className="px-3 py-1 bg-purple-500/20 backdrop-blur-sm rounded-full text-sm font-medium border border-white/10">
              {latency} ms
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex overflow-hidden p-4">
        {isAnyoneScreenSharing ? (
          // Screen share view - main content on right, participants on left
          <div className="flex w-full h-full gap-4">
            {/* Participants sidebar - FIXED: Show all non-screen-sharing participants */}
            <div className="w-1/4 flex flex-col gap-4">
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
                <h3 className="text-sm font-semibold text-purple-200 mb-2">
                  Participants ({otherParticipants.filter(p => p.id !== 'local').length})
                </h3>
                <div className="space-y-3">
                  {otherParticipants.filter(p => p.id !== 'local').map((p) => (
                    <div key={p.id} className="h-24 rounded-xl overflow-hidden relative">
                      {renderParticipant(p, true)}
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Local participant always visible at bottom - unless they're the screen sharer */}
              {screenSharer?.id !== 'local' && (
                <div className="h-24 rounded-xl overflow-hidden relative mt-auto">
                  {renderParticipant(participants.find(p => p.id === 'local')!, true)}
                </div>
              )}
            </div>

            {/* Main screen share view */}
            <div className="flex-1 bg-black/30 rounded-2xl overflow-hidden relative">
              {screenSharer && renderParticipant(screenSharer)}
              <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                {screenSharer?.name} is sharing screen
                {screenSharer?.id === 'local' && ' (You)'}
              </div>
            </div>
          </div>
        ) : (
          // Regular grid view when no one is screen sharing
          <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {participants.map((p) => (
              <div
                key={p.id}
                className={`relative rounded-2xl overflow-hidden shadow-xl transition-all duration-300 bg-white/5 backdrop-blur-sm border border-white/10
                  ${p.id === 'local' ? 'ring-2 ring-purple-400' : ''}`}
              >
                {renderParticipant(p)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="relative z-10 bg-white/5 backdrop-blur-sm border-t border-white/10 p-4 flex justify-center items-center space-x-6">
        <button
          onClick={toggleMic}
          className={`p-3 rounded-full transition-all duration-300 shadow-sm ${audioOn ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={audioOn ? 'Mute' : 'Unmute'}
        >
          {audioOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>

        <button
          onClick={toggleVideo}
          className={`p-3 rounded-full transition-all duration-300 shadow-sm ${cameraOn ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>

        <button
          onClick={toggleScreenShare}
          className={`p-3 rounded-full transition-all duration-300 shadow-sm ${screenShareOn ? 'bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-500 hover:to-blue-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={screenShareOn ? 'Stop screen share' : 'Share screen'}
        >
          {screenShareOn ? <MonitorOff size={20} /> : <Monitor size={20} />}
        </button>

        <button onClick={copyLink} className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-300" title="Copy meeting link">
          <Copy size={20} />
        </button>

        <button
          onClick={() => setShowChat(prev => !prev)}
          className={`p-3 rounded-full transition-all duration-300 ${showChat ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500' : 'bg-white/10 hover:bg-white/20'}`}
          title="Toggle chat"
        >
          <MessageSquare size={20} />
        </button>

        <button onClick={leaveMeeting} className="px-6 py-3 rounded-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 flex items-center gap-2 transition-all duration-300 shadow-lg shadow-red-500/20">
          <PhoneOff size={18} />
          Leave
        </button>
      </div>

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-sm underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Chat Sidebar - always rendered but slides in/out to avoid layout shift */}
      <div
        aria-hidden={!showChat}
        className={`fixed top-0 right-0 h-full z-50 transform transition-transform duration-300 ease-in-out
                    ${showChat ? 'translate-x-0' : 'translate-x-full'}
                    w-full sm:w-80 md:w-96 bg-white/5 backdrop-blur-sm border-l border-white/10 shadow-2xl`}
        style={{ willChange: 'transform' }}
      >
        <div className="flex flex-col h-full">
          <div className="flex justify-between items-center p-4 border-b border-white/10">
            <h2 className="text-lg font-semibold text-purple-200">Meeting Chat</h2>
            <button
              onClick={() => setShowChat(false)}
              className="text-gray-300 hover:text-white p-1 rounded-full"
              aria-label="Close chat"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chat.length === 0 ? (
              <div className="text-center text-gray-400 mt-8">
                No messages yet. Start the conversation!
              </div>
            ) : (
              chat.map((c, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${stringToColor(c.name)}, rgba(0,0,0,0.15))` }}
                  >
                    {c.name[0].toUpperCase()}
                  </div>
                  <div className="flex flex-col max-w-[70%]">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-blue-300">{c.name}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="bg-white/5 rounded-lg px-3 py-2 mt-1 text-gray-200 break-words">
                      {c.message}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 border-t border-white/10">
            <div className="flex gap-2">
              <input
                className="flex-1 px-4 py-2 rounded-full bg-white/10 focus:outline-none focus:ring-2 focus:ring-purple-500"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
                aria-label="Type a message"
              />
              <button
                onClick={sendMessage}
                disabled={!message.trim()}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Copy Success Toast */}
      {copySuccess && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded shadow-lg z-50">
          Meeting link copied to clipboard!
        </div>
      )}
    </div>
  );
}