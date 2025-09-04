import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { LRUCache } from 'lru-cache';

const app = express();
const server = createServer(app);

// Compression middleware
app.use(compression());

// Express rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Enable CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://yourdomain.com'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Redis clients
let pubClient, subClient;
if (process.env.REDIS_URL) {
  try {
    pubClient = createClient({ url: process.env.REDIS_URL });
    subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log('✅ Redis connected successfully');
  } catch (error) {
    console.warn('⚠️ Redis connection failed, using in-memory storage:', error.message);
  }
}

// Socket.IO server
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 30000,
  pingInterval: 15000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  maxHttpBufferSize: 1e6,
  httpCompression: true,
  wsCompression: false,
});

// Use Redis adapter if available
if (pubClient && subClient) {
  io.adapter(createAdapter(pubClient, subClient));
}

// Room management
const MAX_ROOMS = 200;
const MAX_USERS_PER_ROOM = 150;
const MAX_CHAT_HISTORY = 100;

class OptimizedRoom {
  constructor(id) {
    this.id = id;
    this.users = new Map();
    this.chatHistory = [];
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this._usersList = null;
    this._usersListExpiry = 0;
    this.messageCount = 0;
  }

  addUser(socketId, userData) {
    if (this.users.size >= MAX_USERS_PER_ROOM) throw new Error('Room is full');
    this.users.set(socketId, {
      id: socketId,
      name: userData.name,
      cameraOn: userData.cameraOn,
      audioOn: userData.audioOn,
      screenShareOn: userData.screenShareOn,
      joinedAt: Date.now()
    });
    this.lastActivity = Date.now();
    this._invalidateCache();
  }

  removeUser(socketId) {
    const removed = this.users.delete(socketId);
    if (removed) {
      this.lastActivity = Date.now();
      this._invalidateCache();
    }
    return removed;
  }

  updateUserStatus(socketId, status) {
    const user = this.users.get(socketId);
    if (!user) return null;

    if (status.cameraOn !== undefined) user.cameraOn = status.cameraOn;
    if (status.audioOn !== undefined) user.audioOn = status.audioOn;
    if (status.screenShareOn !== undefined) user.screenShareOn = status.screenShareOn;
    if (status.name !== undefined) user.name = status.name;

    this.lastActivity = Date.now();
    this._invalidateCache();
    return user;
  }

  getUsersArray() {
    const now = Date.now();
    if (!this._usersList || now > this._usersListExpiry) {
      this._usersList = Array.from(this.users.values());
      this._usersListExpiry = now + 5000;
    }
    return this._usersList;
  }

  getUsersStatus() {
    const status = {};
    for (const [socketId, user] of this.users) {
      status[socketId] = {
        cameraOn: user.cameraOn,
        audioOn: user.audioOn,
        screenShareOn: user.screenShareOn
      };
    }
    return status;
  }

  _invalidateCache() {
    this._usersList = null;
    this._usersListExpiry = 0;
  }

  isEmpty() {
    return this.users.size === 0;
  }

  addMessage(chatMessage) {
    this.messageCount++;
    this.chatHistory.push({
      ...chatMessage,
      id: this.messageCount
    });
    
    if (this.chatHistory.length > MAX_CHAT_HISTORY) {
      this.chatHistory.shift();
    }
    
    this.lastActivity = Date.now();
  }

  getChatHistory(limit = MAX_CHAT_HISTORY) {
    return this.chatHistory.slice(-limit);
  }
}

// LRU cache for rooms
const rooms = new LRUCache({
  max: MAX_ROOMS,
  ttl: 1000 * 60 * 60 * 2, // 2 hours
  allowStale: false,
  updateAgeOnGet: true,
  dispose: (roomId, room) => {
    console.log(`🗑️ Room ${roomId} disposed from cache (${room.users.size} users, ${room.chatHistory.length} messages)`);
    if (room.users.size > 0) {
      io.to(roomId).emit('room-disposed', { 
        message: 'Room has been disposed due to inactivity',
        timestamp: Date.now()
      });
    }
  }
});

// Rate limiting
const rateLimits = new LRUCache({ 
  max: 10000, 
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: false
});

const isRateLimited = (socketId, action, limit = 10, windowMs = 60000) => {
  const key = `${socketId}:${action}`;
  const now = Date.now();
  let rateLimit = rateLimits.get(key);
  
  if (!rateLimit || now > rateLimit.resetTime) {
    rateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return false;
  }
  
  if (rateLimit.count >= limit) return true;
  rateLimit.count++;
  rateLimits.set(key, rateLimit);
  return false;
};

// Utility functions
const getOrCreateRoom = (roomId) => {
  let room = rooms.get(roomId);
  if (!room) {
    room = new OptimizedRoom(roomId);
    rooms.set(roomId, room);
    console.log(`🏠 Created new room: ${roomId}`);
  }
  return room;
};

// Cleanup function
let cleanupScheduled = false;
const scheduleCleanup = () => {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  
  setTimeout(() => {
    cleanupScheduled = false;
    const now = Date.now();
    const maxInactiveTime = 30 * 60 * 1000;
    let cleanedRooms = 0;
    
    for (const [roomId, room] of rooms.entries()) {
      if (room.isEmpty() && (now - room.lastActivity) > maxInactiveTime) {
        rooms.delete(roomId);
        cleanedRooms++;
        console.log(`🧹 Cleaned up empty room: ${roomId}`);
      }
    }
    
    if (cleanedRooms > 0) {
      console.log(`🧹 Cleanup completed: ${cleanedRooms} rooms removed`);
    }
  }, 60000);
};

// Connection stats
const connectionStats = { 
  total: 0, 
  peak: 0, 
  lastPeakTime: Date.now(),
  totalConnections: 0
};

// Socket.IO handlers
io.on('connection', (socket) => {
  connectionStats.total++;
  connectionStats.totalConnections++;
  
  if (connectionStats.total > connectionStats.peak) {
    connectionStats.peak = connectionStats.total;
    connectionStats.lastPeakTime = Date.now();
  }
  
  console.log(`👤 Connected: ${socket.id} (Total: ${connectionStats.total}, Peak: ${connectionStats.peak})`);

  let currentRoomId = null;
  let userName = null;

  // Ping-pong for latency measurement
  socket.on('ping-from-client', () => {
    socket.emit('pong-from-server', Date.now());
  });

  socket.on('join-room', ({ roomId, name, cameraOn = false, audioOn = false, screenShareOn = false }) => {
    try {
      // Input validation
      if (!roomId?.trim() || !name?.trim() || roomId.length > 50 || name.length > 30) {
        socket.emit('error', { message: 'Invalid room ID or name' });
        return;
      }

      // Rate limiting
      if (isRateLimited(socket.id, 'join-room', 5, 60000)) {
        socket.emit('error', { message: 'Too many join attempts. Please wait.' });
        return;
      }

      const room = getOrCreateRoom(roomId.trim());
      currentRoomId = roomId.trim();
      userName = name.trim();

      // Get existing users and their status
      const existingUsers = room.getUsersArray().map(u => ({ 
        id: u.id, 
        name: u.name,
        joinedAt: u.joinedAt
      }));
      const existingStatus = room.getUsersStatus();

      // Join the socket room
      socket.join(roomId);
      
      // Add user to room
      room.addUser(socket.id, {
        name: userName,
        cameraOn,
        audioOn,
        screenShareOn
      });

      // Send existing users and their status to the new user
      socket.emit('existing-users', {
        users: existingUsers,
        roomUserStatus: existingStatus
      });

      // NEW: Send current screen share status to the joining user
      const screenSharers = room.getUsersArray().filter(u => u.screenShareOn);
      if (screenSharers.length > 0) {
        screenSharers.forEach(sharer => {
          socket.emit('user-started-screen-share', { 
            userId: sharer.id, 
            name: sharer.name 
          });
        });
      }

      // Send chat history to the joining user
      const chatHistory = room.getChatHistory();
      if (chatHistory.length > 0) {
        socket.emit('chat-history', chatHistory);
        console.log(`📧 Sent ${chatHistory.length} chat messages to ${userName} in room ${roomId}`);
      }

      // Notify other users about the new join
      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        name: userName,
        cameraOn,
        audioOn,
        screenShareOn
      });

      console.log(`✅ ${userName} joined room ${roomId} (${room.users.size}/${MAX_USERS_PER_ROOM} users, ${room.chatHistory.length} messages)`);
    } catch (error) {
      console.error('❌ Error in join-room:', error);
      socket.emit('error', { 
        message: error.message === 'Room is full' ? 
          `Room is full (max ${MAX_USERS_PER_ROOM} users)` : 
          'Failed to join room. Please try again.' 
      });
    }
  });

  // Enhanced WebRTC signaling with better screen share handling
  socket.on('offer', (payload) => {
    const room = rooms.get(currentRoomId);
    const user = room?.users.get(socket.id);
    if (user && payload.to) {
      console.log(`📡 Offer from ${user.name} to ${payload.to} - Screen: ${user.screenShareOn ? 'Yes' : 'No'}`);
      socket.to(payload.to).emit('offer', {
        sdp: payload.sdp,
        from: socket.id,
        name: user.name,
        cameraOn: user.cameraOn,
        audioOn: user.audioOn,
        screenShareOn: user.screenShareOn
      });
    }
  });

  socket.on('answer', (payload) => {
    if (!payload?.to || !currentRoomId) return;
    if (isRateLimited(socket.id, 'signaling', 50, 60000)) return;

    const room = rooms.get(currentRoomId);
    if (!room?.users.has(socket.id)) return;

    console.log(`📡 Answer from ${socket.id} to ${payload.to}`);
    socket.to(payload.to).emit('answer', { ...payload, from: socket.id });
  });

  socket.on('ice-candidate', (payload) => {
    if (!payload?.to || !currentRoomId) return;
    if (isRateLimited(socket.id, 'signaling', 100, 60000)) return;

    const room = rooms.get(currentRoomId);
    if (!room?.users.has(socket.id)) return;

    socket.to(payload.to).emit('ice-candidate', { ...payload, from: socket.id });
  });

  // Enhanced media status changes with screen share notifications
  socket.on('media-status-change', (status) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    
    const oldUser = { ...room.users.get(socket.id) };
    const updatedUser = room.updateUserStatus(socket.id, status);
    
    if (updatedUser) {
      console.log(`📺 Media status change for ${updatedUser.name}: Camera=${updatedUser.cameraOn}, Audio=${updatedUser.audioOn}, Screen=${updatedUser.screenShareOn}`);
      
      // Broadcast the status change
      socket.to(currentRoomId).emit('media-status-change', {
        userId: socket.id,
        cameraOn: updatedUser.cameraOn,
        audioOn: updatedUser.audioOn,
        screenShareOn: updatedUser.screenShareOn
      });

      // Special handling for screen share state changes
      if (oldUser.screenShareOn !== updatedUser.screenShareOn) {
        if (updatedUser.screenShareOn) {
          console.log(`🖥️ ${updatedUser.name} started screen sharing`);
          socket.to(currentRoomId).emit('user-started-screen-share', { 
            userId: socket.id,
            name: updatedUser.name 
          });
        } else {
          console.log(`🖥️ ${updatedUser.name} stopped screen sharing`);
          socket.to(currentRoomId).emit('user-stopped-screen-share', { 
            userId: socket.id,
            name: updatedUser.name 
          });
        }
      }
    }
  });

  // Chat message handling
  socket.on('chat-message', ({ roomId, message, name }) => {
    try {
      const room = rooms.get(roomId);
      const user = room?.users.get(socket.id);
      
      // Validation
      if (!room || !user || !message?.trim() || !name?.trim() || user.name !== name.trim()) {
        console.warn(`❌ Chat validation failed for ${socket.id}`);
        return;
      }
      
      if (message.length > 500) {
        socket.emit('error', { message: 'Message too long (max 500 characters)' });
        return;
      }
      
      if (isRateLimited(socket.id, 'chat', 30, 60000)) {
        socket.emit('error', { message: 'Sending messages too quickly. Please slow down.' });
        return;
      }

      const chatMessage = { 
        name: user.name, 
        message: message.trim(), 
        timestamp: Date.now() 
      };

      // Store message in room history
      room.addMessage(chatMessage);

      // Broadcast to all users in the room (including sender)
      io.to(roomId).emit('chat-message', chatMessage);
      
      console.log(`💬 Chat message in room ${roomId}: ${user.name}: ${message.trim()}`);
    } catch (error) {
      console.error('❌ Error in chat-message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Screen sharing events (legacy support)
  socket.on('start-screen-share', () => {
    if (currentRoomId) {
      // Update the user's status in the room
      const room = rooms.get(currentRoomId);
      if (room) {
        room.updateUserStatus(socket.id, { screenShareOn: true });
      }
      
      socket.to(currentRoomId).emit('user-started-screen-share', { 
        userId: socket.id,
        name: userName 
      });
      console.log(`🖥️ User ${userName} started screen sharing in room ${currentRoomId}`);
    }
  });

  socket.on('stop-screen-share', () => {
    if (currentRoomId) {
      // Update the user's status in the room
      const room = rooms.get(currentRoomId);
      if (room) {
        room.updateUserStatus(socket.id, { screenShareOn: false });
      }
      
      socket.to(currentRoomId).emit('user-stopped-screen-share', { 
        userId: socket.id,
        name: userName 
      });
      console.log(`🖥️ User ${userName} stopped screen sharing in room ${currentRoomId}`);
    }
  });

  // Enhanced disconnect handling
  socket.on('disconnect', (reason) => {
    connectionStats.total = Math.max(0, connectionStats.total - 1);
    console.log(`👋 Disconnected: ${socket.id} (${reason}) - Total: ${connectionStats.total}`);

    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        const wasRemoved = room.removeUser(socket.id);
        if (wasRemoved) {
          socket.to(currentRoomId).emit('user-left', socket.id);
          console.log(`👤 User ${userName || socket.id} left room ${currentRoomId} (${room.users.size} users remaining)`);
          
          // Schedule cleanup if room is empty
          if (room.isEmpty()) {
            scheduleCleanup();
          }
        }
      }
    }
  });

  socket.on('error', (error) => {
    console.error(`❌ Socket error ${socket.id}:`, error);
  });
});

// Health endpoints
app.get('/health', (req, res) => {
  const totalUsers = Array.from(rooms.values()).reduce((sum, room) => sum + room.users.size, 0);
  const totalMessages = Array.from(rooms.values()).reduce((sum, room) => sum + room.chatHistory.length, 0);
  
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    connections: connectionStats.total,
    peak_connections: connectionStats.peak,
    total_connections_served: connectionStats.totalConnections,
    rooms: rooms.size,
    total_users: totalUsers,
    total_messages: totalMessages,
    memory_usage: process.memoryUsage(),
    uptime: process.uptime(),
    redis_connected: !!(pubClient && subClient)
  });
});

app.get('/api/rooms/:roomId/stats', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({ 
    roomId,
    userCount: room.users.size,
    messageCount: room.messageCount,
    chatHistoryLength: room.chatHistory.length,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
    users: room.getUsersArray().map(u => ({ 
      id: u.id, 
      name: u.name, 
      joinedAt: u.joinedAt,
      cameraOn: u.cameraOn,
      audioOn: u.audioOn,
      screenShareOn: u.screenShareOn
    })),
    recentMessages: room.getChatHistory(10)
  });
});

app.get('/api/stats', (req, res) => {
  const roomStats = Array.from(rooms.values()).map(room => ({ 
    id: room.id, 
    users: room.users.size, 
    messages: room.messageCount,
    chatHistory: room.chatHistory.length,
    lastActivity: room.lastActivity,
    createdAt: room.createdAt
  }));
  
  res.json({ 
    totalRooms: rooms.size,
    totalConnections: connectionStats.total,
    peakConnections: connectionStats.peak,
    totalConnectionsServed: connectionStats.totalConnections,
    totalUsers: roomStats.reduce((sum, room) => sum + room.users, 0),
    totalMessages: roomStats.reduce((sum, room) => sum + room.chatHistory, 0),
    rooms: roomStats,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    redisConnected: !!(pubClient && subClient)
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Express error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`📡 ${signal} received - shutting down gracefully`);
  
  io.emit('server-shutdown', { 
    message: 'Server maintenance in progress. You will be reconnected automatically.', 
    reconnect: true,
    timestamp: Date.now()
  });
  
  setTimeout(() => {
    server.close(() => {
      console.log('🔌 HTTP server closed');
      
      if (pubClient) {
        pubClient.quit().then(() => console.log('📡 Redis pub client closed'));
      }
      if (subClient) {
        subClient.quit().then(() => console.log('📡 Redis sub client closed'));
      }
      
      console.log('✅ Server shut down gracefully');
      process.exit(0);
    });
  }, 3000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Periodic garbage collection
if (global.gc) {
  setInterval(() => {
    global.gc();
    console.log('🗑️ Manual garbage collection triggered');
  }, 5 * 60 * 1000);
}

// Server startup
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 Optimized Socket.IO server running on ${HOST}:${PORT}`);
  console.log(`📊 Health: http://${HOST}:${PORT}/health`);
  console.log(`📈 Stats: http://${HOST}:${PORT}/api/stats`);
  console.log(`🎯 Configuration:`);
  console.log(`   - Max users per room: ${MAX_USERS_PER_ROOM}`);
  console.log(`   - Max rooms: ${MAX_ROOMS}`);
  console.log(`   - Chat history limit: ${MAX_CHAT_HISTORY}`);
  console.log(`💾 Redis adapter: ${pubClient ? '✅ Enabled' : '❌ Disabled (using memory)'}`);
  console.log(`🛡️ Features: Rate limiting, compression, CORS, graceful shutdown`);
});