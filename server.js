const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Separate waiting slots per mode so text users match text, voice match voice.
const waiting = { voice: null, text: null };
const partners = new Map();
const ROOMS = new Set(['lounge', 'chill']);
const ROOM_CAP = 5;
const SKIP_COOLDOWN_MS = 3000;
const lastFindPartner = new Map();
let reportCount = 0;

function cleanupPartner(socket) {
  const partnerId = partners.get(socket.id);
  if (partnerId) {
    partners.delete(socket.id);
    partners.delete(partnerId);
    const partner = io.sockets.sockets.get(partnerId);
    if (partner) partner.emit('partner-left');
  }
  for (const q of Object.keys(waiting)) {
    if (waiting[q] && waiting[q].id === socket.id) waiting[q] = null;
  }
}

function leaveRoom(socket) {
  const room = socket.data?.room;
  if (!room) return;
  socket.to(room).emit('peer-left', { peerId: socket.id });
  socket.leave(room);
  socket.data.room = null;
  io.to(room).emit('room-count', { count: io.sockets.adapter.rooms.get(room)?.size || 0 });
  broadcastLobbyCounts();
}

function getLobbyCounts() {
  const counts = {};
  for (const room of ROOMS) {
    counts[room] = io.sockets.adapter.rooms.get(room)?.size || 0;
  }
  return counts;
}

function broadcastLobbyCounts() {
  io.emit('lobby-counts', getLobbyCounts());
}

function broadcastOnline() {
  io.emit('online', { count: io.engine.clientsCount });
}

io.on('connection', (socket) => {
  // Send current lobby counts to the newly-connected client
  socket.emit('lobby-counts', getLobbyCounts());
  socket.emit('online', { count: io.engine.clientsCount });
  broadcastOnline();

  socket.on('find-partner', (opts) => {
    const mode = opts && opts.mode === 'text' ? 'text' : 'voice';
    const last = lastFindPartner.get(socket.id) || 0;
    const wait = SKIP_COOLDOWN_MS - (Date.now() - last);
    if (wait > 0) {
      socket.emit('skip-cooldown', { ms: wait });
      return;
    }
    lastFindPartner.set(socket.id, Date.now());
    cleanupPartner(socket);
    leaveRoom(socket);

    const slot = waiting[mode];
    if (slot && slot.id !== socket.id && slot.connected) {
      const partner = slot;
      waiting[mode] = null;
      partners.set(socket.id, partner.id);
      partners.set(partner.id, socket.id);
      socket.emit('matched', { initiator: true, peerId: partner.id, mode });
      partner.emit('matched', { initiator: false, peerId: socket.id, mode });
    } else {
      waiting[mode] = socket;
      socket.emit('waiting', { mode });
    }
  });

  socket.on('report', () => {
    reportCount++;
    const partnerId = partners.get(socket.id);
    console.log(`[report] ${socket.id} reported ${partnerId || '(room/none)'} — total ${reportCount}`);
    // No moderation backend in this MVP; we log and let the client skip.
  });

  socket.on('signal', (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit('signal', data);
  });

  socket.on('join-room', ({ room }) => {
    if (!ROOMS.has(room)) return;
    const existingSet = io.sockets.adapter.rooms.get(room) || new Set();
    if (existingSet.size >= ROOM_CAP) {
      socket.emit('room-full', { room, cap: ROOM_CAP });
      return;
    }
    cleanupPartner(socket);
    leaveRoom(socket);

    const existing = Array.from(existingSet);
    socket.join(room);
    socket.data.room = room;

    socket.emit('room-joined', { room, peers: existing });
    socket.to(room).emit('peer-joined', { peerId: socket.id });
    io.to(room).emit('room-count', { count: io.sockets.adapter.rooms.get(room).size });
    broadcastLobbyCounts();
  });

  // Room signaling — `to` field routes to a specific peer in the room
  socket.on('room-signal', ({ to, ...payload }) => {
    if (!socket.data?.room) return;
    io.to(to).emit('room-signal', { from: socket.id, ...payload });
  });

  socket.on('room-text', ({ text }) => {
    const room = socket.data?.room;
    if (!room) return;
    if (typeof text !== 'string' || text.length > 500) return;
    socket.to(room).emit('room-text', { from: socket.id, text });
  });

  socket.on('leave', () => { cleanupPartner(socket); leaveRoom(socket); });
  socket.on('disconnect', () => {
    cleanupPartner(socket);
    leaveRoom(socket);
    lastFindPartner.delete(socket.id);
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Voice chat server listening on http://localhost:${PORT}`);
});
