const socket = io();

const loginView = document.getElementById('login-view');
const gameView = document.getElementById('game-view');
const loginForm = document.getElementById('login-form');
const nameInput = document.getElementById('name-input');
const loginError = document.getElementById('login-error');

const playerBadge = document.getElementById('player-badge');
const connectionDot = document.getElementById('connection-dot');
const logoutBtn = document.getElementById('logout-btn');

const statusPill = document.getElementById('status-pill');
const elapsedLabel = document.getElementById('elapsed-label');
const pointsValue = document.getElementById('points-value');
const progressFill = document.getElementById('progress-fill');
const timerCaption = document.getElementById('timer-caption');
const winnerBanner = document.getElementById('winner-banner');
const winnerName = document.getElementById('winner-name');
const winnerMeta = document.getElementById('winner-meta');
const pressBtn = document.getElementById('press-btn');

const adminPanel = document.getElementById('admin-panel');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');
const resetStartBtn = document.getElementById('reset-start-btn');
const configForm = document.getElementById('config-form');
const pointsInput = document.getElementById('points-input');
const stepInput = document.getElementById('step-input');
const adminMsg = document.getElementById('admin-msg');
const playersCount = document.getElementById('players-count');
const playersList = document.getElementById('players-list');

let currentUser = null; // { name, isAdmin }
let gameState = null;
let clockOffsetMs = 0;
let rafId = null;

function joinWithName(name) {
  socket.emit('join', { name });
}

// Auto-rejoin if user refreshed the tab
const savedName = sessionStorage.getItem('ff_name');
if (savedName) {
  nameInput.value = savedName;
}

socket.on('connect', () => {
  connectionDot.classList.remove('offline');
  connectionDot.classList.add('online');
  connectionDot.title = 'Connected';

  const stored = sessionStorage.getItem('ff_name');
  if (stored) {
    joinWithName(stored);
  }
});

socket.on('disconnect', () => {
  connectionDot.classList.remove('online');
  connectionDot.classList.add('offline');
  connectionDot.title = 'Disconnected';
});

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const name = nameInput.value.trim();
  if (!name) {
    loginError.textContent = 'Please enter your name.';
    loginError.classList.remove('hidden');
    return;
  }
  joinWithName(name);
});

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('ff_name');
  currentUser = null;
  gameState = null;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  adminPanel.classList.add('hidden');
  gameView.classList.add('hidden');
  loginView.classList.remove('hidden');
  nameInput.value = '';
  nameInput.focus();
});

socket.on('join:error', ({ message }) => {
  loginError.textContent = message || 'Unable to join.';
  loginError.classList.remove('hidden');
});

socket.on('joined', (user) => {
  currentUser = user;
  sessionStorage.setItem('ff_name', user.name);

  playerBadge.textContent = user.isAdmin ? `${user.name} (Admin)` : user.name;
  playerBadge.classList.toggle('admin', user.isAdmin);

  if (user.isAdmin) {
    adminPanel.classList.remove('hidden');
  } else {
    adminPanel.classList.add('hidden');
  }

  loginView.classList.add('hidden');
  gameView.classList.remove('hidden');
});

socket.on('state', (state) => {
  gameState = state;
  clockOffsetMs = state.serverNow - Date.now();

  if (currentUser?.isAdmin) {
    // Keep config inputs synced when not actively editing
    if (document.activeElement !== pointsInput) {
      pointsInput.value = state.config.pointsList.join(', ');
    }
    if (document.activeElement !== stepInput) {
      stepInput.value = String(state.config.stepDurationSec);
    }
    updateAdminButtons();
  }

  renderFrame();
  syncAnimationLoop();
});

socket.on('users', (users) => {
  playersCount.textContent = `${users.length} online`;
  playersList.innerHTML = '';
  for (const u of users) {
    const li = document.createElement('li');
    li.textContent = u.isAdmin ? `${u.name} (Admin)` : u.name;
    playersList.appendChild(li);
  }
});

socket.on('admin:error', ({ message }) => {
  adminMsg.textContent = message;
  adminMsg.classList.add('error');
});

pressBtn.addEventListener('click', () => {
  if (!gameState || gameState.status !== 'running') return;
  socket.emit('press');
});

// Admin controls
startBtn.addEventListener('click', () => socket.emit('admin:start'));
pauseBtn.addEventListener('click', () => socket.emit('admin:pause'));
resetBtn.addEventListener('click', () => socket.emit('admin:reset'));
resetStartBtn.addEventListener('click', () => socket.emit('admin:resetAndStart'));

configForm.addEventListener('submit', (e) => {
  e.preventDefault();
  adminMsg.textContent = '';
  adminMsg.classList.remove('error');

  const pointsList = pointsInput.value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const stepDurationSec = Number(stepInput.value);

  if (pointsList.length === 0 || !Number.isFinite(stepDurationSec) || stepDurationSec < 1) {
    adminMsg.textContent = 'Invalid points or step seconds.';
    adminMsg.classList.add('error');
    return;
  }

  socket.emit('admin:updateConfig', { pointsList, stepDurationSec });
  adminMsg.textContent = 'Updated & reset!';
  setTimeout(() => {
    if (!adminMsg.classList.contains('error')) {
      adminMsg.textContent = '';
    }
  }, 2500);
});

function updateAdminButtons() {
  if (!gameState) return;
  const { status } = gameState;
  startBtn.disabled = status === 'running' || status === 'stopped';
  startBtn.textContent = status === 'paused' ? 'Resume' : 'Start';
  pauseBtn.disabled = status !== 'running';
}

function getClientElapsedMs() {
  if (!gameState) return 0;
  if (gameState.status === 'running' && gameState.startedAt !== null) {
    const serverNowEstimate = Date.now() + clockOffsetMs;
    return Math.max(0, gameState.accumulatedMs + (serverNowEstimate - gameState.startedAt));
  }
  return Math.max(0, gameState.accumulatedMs);
}

function renderFrame() {
  if (!gameState) return;

  const { status, winner, config } = gameState;
  const { pointsList, stepDurationSec } = config;
  const stepMs = stepDurationSec * 1000;
  const elapsedMs = getClientElapsedMs();

  const tierIndex = Math.min(Math.floor(elapsedMs / stepMs), pointsList.length - 1);
  const currentPoints = pointsList[tierIndex];
  const isLastTier = tierIndex === pointsList.length - 1;

  // Status pill
  statusPill.className = `status-pill ${status}`;
  if (status === 'idle') statusPill.textContent = 'Ready';
  else if (status === 'running') statusPill.textContent = 'Live';
  else if (status === 'paused') statusPill.textContent = 'Paused';
  else if (status === 'stopped') statusPill.textContent = 'Stopped';

  // Elapsed
  elapsedLabel.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;

  // Points
  pointsValue.textContent = String(currentPoints);

  // Progress bar
  progressFill.classList.remove('low', 'final-tier');
  if (isLastTier) {
    progressFill.style.width = '100%';
    progressFill.classList.add('final-tier');
    timerCaption.textContent = `${currentPoints} pt (continues)`;
  } else {
    const tierElapsed = elapsedMs - tierIndex * stepMs;
    const remainingMs = Math.max(0, stepMs - tierElapsed);
    const pct = Math.max(0, Math.min(100, (remainingMs / stepMs) * 100));
    progressFill.style.width = `${pct.toFixed(2)}%`;
    if (pct <= 30) {
      progressFill.classList.add('low');
    }
    const nextPoints = pointsList[tierIndex + 1];
    timerCaption.textContent = `${(remainingMs / 1000).toFixed(1)}s until ${nextPoints} pts`;
  }

  // Winner banner
  if (status === 'stopped' && winner) {
    winnerBanner.classList.remove('hidden');
    winnerName.textContent = winner.name;
    winnerMeta.textContent = `${winner.points} pts • ${(winner.elapsedMs / 1000).toFixed(2)}s`;
  } else {
    winnerBanner.classList.add('hidden');
  }

  // Press button
  pressBtn.disabled = status !== 'running';
}

function syncAnimationLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (gameState && gameState.status === 'running') {
    const tick = () => {
      renderFrame();
      if (gameState && gameState.status === 'running') {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
  }
}

