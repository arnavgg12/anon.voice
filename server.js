const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

let waiting = null;
const partners = new Map();

function cleanupPartner(socket) {
  const partnerId = partners.get(socket.id);
  if (partnerId) {
    partners.delete(socket.id);
    partners.delete(partnerId);
    const partner = io.sockets.sockets.get(partnerId);
    if (partner) partner.emit('partner-left');
  }
  if (waiting && waiting.id === socket.id) waiting = null;
}

io.on('connection', (socket) => {
  socket.on('find-partner', () => {
    cleanupPartner(socket);

    if (waiting && waiting.id !== socket.id && waiting.connected) {
      const partner = waiting;
      waiting = null;
      partners.set(socket.id, partner.id);
      partners.set(partner.id, socket.id);
      socket.emit('matched', { initiator: true });
      partner.emit('matched', { initiator: false });
    } else {
      waiting = socket;
      socket.emit('waiting');
    }
  });

  socket.on('signal', (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit('signal', data);
  });

  socket.on('leave', () => cleanupPartner(socket));
  socket.on('disconnect', () => cleanupPartner(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Voice chat server listening on http://localhost:${PORT}`);
});
