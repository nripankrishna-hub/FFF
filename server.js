const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

const gameState = {
  status: 'idle', // 'idle' | 'running' | 'paused' | 'stopped'
  startedAt: null,
  accumulatedMs: 0,
  winner: null, // { name, points, elapsedMs }
  config: {
    pointsList: [10, 5, 3, 1],
    stepDurationSec: 10,
  },
};

function getElapsedMs(now = Date.now()) {
  if (gameState.status === 'running' && gameState.startedAt !== null) {
    return gameState.accumulatedMs + (now - gameState.startedAt);
  }
  return gameState.accumulatedMs;
}

function getPointsForElapsed(elapsedMs) {
  const { pointsList, stepDurationSec } = gameState.config;
  const stepMs = stepDurationSec * 1000;
  const tierIndex = Math.min(Math.floor(elapsedMs / stepMs), pointsList.length - 1);
  return pointsList[tierIndex];
}

function getPublicState() {
  const now = Date.now();
  return {
    status: gameState.status,
    startedAt: gameState.startedAt,
    accumulatedMs: gameState.accumulatedMs,
    winner: gameState.winner,
    config: gameState.config,
    serverNow: now,
  };
}

function getConnectedUsers() {
  const users = [];
  for (const [, s] of io.sockets.sockets) {
    if (s.data && s.data.name) {
      users.push({
        id: s.id,
        name: s.data.name,
        isAdmin: Boolean(s.data.isAdmin),
      });
    }
  }
  return users;
}

function broadcastState() {
  io.emit('state', getPublicState());
}

function broadcastUsers() {
  io.emit('users', getConnectedUsers());
}

io.on('connection', (socket) => {
  socket.on('join', (payload) => {
    const rawName = typeof payload?.name === 'string' ? payload.name.trim() : '';
    if (!rawName) {
      socket.emit('join:error', { message: 'Please enter your name.' });
      return;
    }

    const safeName = rawName.slice(0, 40);
    socket.data.name = safeName;
    socket.data.isAdmin = safeName.toLowerCase() === 'admin';

    socket.emit('joined', {
      name: socket.data.name,
      isAdmin: socket.data.isAdmin,
    });
    socket.emit('state', getPublicState());
    broadcastUsers();
  });

  socket.on('press', () => {
    if (!socket.data?.name) return;
    if (gameState.status !== 'running') return;

    const now = Date.now();
    const elapsedMs = getElapsedMs(now);
    const points = getPointsForElapsed(elapsedMs);

    gameState.status = 'stopped';
    gameState.accumulatedMs = elapsedMs;
    gameState.startedAt = null;
    gameState.winner = {
      name: socket.data.name,
      points,
      elapsedMs,
    };

    broadcastState();
  });

  socket.on('admin:start', () => {
    if (!socket.data?.isAdmin) return;
    if (gameState.status !== 'idle' && gameState.status !== 'paused') return;

    gameState.startedAt = Date.now();
    gameState.status = 'running';
    broadcastState();
  });

  socket.on('admin:pause', () => {
    if (!socket.data?.isAdmin) return;
    if (gameState.status !== 'running') return;

    gameState.accumulatedMs = getElapsedMs(Date.now());
    gameState.startedAt = null;
    gameState.status = 'paused';
    broadcastState();
  });

  socket.on('admin:continue', () => {
    if (!socket.data?.isAdmin) return;
    if (gameState.status !== 'stopped') return;

    gameState.winner = null;
    gameState.startedAt = Date.now();
    gameState.status = 'running';
    broadcastState();
  });

  socket.on('admin:reset', () => {
    if (!socket.data?.isAdmin) return;

    gameState.status = 'idle';
    gameState.startedAt = null;
    gameState.accumulatedMs = 0;
    gameState.winner = null;
    broadcastState();
  });

  socket.on('admin:resetAndStart', () => {
    if (!socket.data?.isAdmin) return;

    gameState.status = 'running';
    gameState.startedAt = Date.now();
    gameState.accumulatedMs = 0;
    gameState.winner = null;
    broadcastState();
  });

  socket.on('admin:updateConfig', (payload) => {
    if (!socket.data?.isAdmin) return;

    const rawPoints = Array.isArray(payload?.pointsList) ? payload.pointsList : [];
    const parsedPoints = rawPoints
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);

    const stepDurationSec = Number(payload?.stepDurationSec);

    if (parsedPoints.length === 0 || !Number.isFinite(stepDurationSec) || stepDurationSec < 1) {
      socket.emit('admin:error', {
        message: 'Provide at least one positive point value and a step duration of at least 1 second.',
      });
      return;
    }

    gameState.config = {
      pointsList: parsedPoints,
      stepDurationSec,
    };
    gameState.status = 'idle';
    gameState.startedAt = null;
    gameState.accumulatedMs = 0;
    gameState.winner = null;
    broadcastState();
  });

  socket.on('disconnect', () => {
    if (socket.data?.name) {
      broadcastUsers();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Fastest Finger server listening on port ${PORT}`);
});

