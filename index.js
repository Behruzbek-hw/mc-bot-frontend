const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const bcrypt = require('bcrypt');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'bot_logs.log' }),
    new winston.transports.Console()
  ]
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Static files service
app.use(express.static('public'));
app.use(express.json());

// Bots, timers, IP tracking, and users
const bots = new Map();
const timers = new Map();
const ipBots = new Map(); // Track bots per IP
const users = new Map(); // Add this line to declare users Map
const supportedVersions = [
  '1.13.1', '1.13.2', '1.14', '1.14.1', '1.14.2', '1.14.3', '1.14.4', '1.15', '1.15.1', '1.15.2',
  '1.16', '1.16.1', '1.16.2', '1.16.3', '1.16.4', '1.16.5', '1.17', '1.17.1', '1.18', '1.18.1',
  '1.18.2', '1.19', '1.19.1', '1.19.2', '1.19.3', '1.19.4', '1.20', '1.20.1', '1.20.2', '1.20.3',
  '1.20.4', '1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8'
];

// Dummy users (to be replaced with a database later)
const dummyUsers = new Map([
  ['user1', { password: bcrypt.hashSync('password1', 10), bots: new Map() }],
  ['user2', { password: bcrypt.hashSync('password2', 10), bots: new Map() }]
]);

// Timer setup
function startTimer(userId) {
  const startTime = Date.now();
  timers.set(userId, { startTime, interval: null });

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    io.to(userId).emit('timer', elapsed);
  }, 1000);

  timers.get(userId).interval = interval;
}

// Create bot
function createBot(userId, config) {
  const botConfig = {
    username: config['bot-account']['username'] || `CrackedBot_${Math.floor(Math.random() * 1000)}`,
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  };

  if (config['bot-account']['auth'] === 'microsoft' && config['bot-account']['password']) {
    botConfig.auth = 'microsoft';
    botConfig.password = config['bot-account']['password'];
  } else {
    botConfig.auth = 'offline';
  }

  const bot = mineflayer.createBot(botConfig);

  bot.loadPlugin(pathfinder);
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);

  if (bot.settings && typeof bot.settings.colorsEnabled !== 'undefined') {
    bot.settings.colorsEnabled = false;
  }

  let pendingPromise = Promise.resolve();

  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      logger.info(`[Auth] Sent /register for ${userId}`);

      bot.once('chat', (username, message) => {
        io.to(userId).emit('message', `<${username}> ${message}`);
        if (message.includes('successfully registered') || message.includes('already registered')) {
          resolve();
        } else {
          reject(`Registration failed: ${message}`);
        }
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      logger.info(`[Auth] Sent /login for ${userId}`);

      bot.once('chat', (username, message) => {
        io.to(userId).emit('message', `<${username}> ${message}`);
        if (message.includes('successfully logged in')) {
          resolve();
        } else {
          reject(`Login failed: ${message}`);
        }
      });
    });
  }

  bot.once('spawn', () => {
    logger.info(`[AfkBot] Bot joined for ${userId}`);
    io.to(userId).emit('message', 'Bot connected to server');
    io.to(userId).emit('botStatus', { connected: true, position: bot.entity.position });

    if (config.utils['auto-auth'].enabled) {
      const password = config.utils['auto-auth'].password;
      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch((error) => {
          logger.error(`[ERROR] ${error}`);
          io.to(userId).emit('message', `Error: ${error}`);
        });
    }

    if (config.utils['chat-messages'].enabled) {
      const messages = config.utils['chat-messages']['messages'];
      if (config.utils['chat-messages'].repeat) {
        let i = 0;
        let msg_timer = setInterval(() => {
          bot.chat(`${messages[i]}`);
          io.to(userId).emit('message', `Message sent: ${messages[i]}`);
          i = (i + 1) % messages.length;
        }, config.utils['chat-messages']['repeat-delay'] * 1000);
        bots.get(userId).msg_timer = msg_timer;
      } else {
        messages.forEach((msg) => {
          bot.chat(msg);
          io.to(userId).emit('message', `Message sent: ${msg}`);
        });
      }
    }

    const pos = config.position;
    if (config.position.enabled) {
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk'].enabled) {
      const movement = config.utils['anti-afk'].movement || 'jump';
      startAntiAFK(bot, movement, userId);
    }
  });

  bot.on('chat', (username, message) => {
    io.to(userId).emit('chat', `<${username}> ${message}`);
  });

  bot.on('goal_reached', () => {
    io.to(userId).emit('message', `Bot reached ${bot.entity.position}`);
  });

  bot.on('death', () => {
    io.to(userId).emit('message', `Bot died and respawned at ${bot.entity.position}`);
  });

  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      io.to(userId).emit('message', `Bot disconnected, reconnecting...`);
      setTimeout(() => createBot(userId, config), config.utils['auto-recconect-delay']);
    });
  }

  bot.on('kicked', (reason) => {
    io.to(userId).emit('message', `Bot was kicked: ${reason}`);
  });

  bot.on('error', (err) => {
    logger.error(`[ERROR] ${err.message} for ${userId}`);
    io.to(userId).emit('message', `Error: ${err.message}`);
  });

  bots.set(userId, { bot, stats: { messagesSent: 0, uptime: 0 } });
}

// Anti-AFK movement logic
function startAntiAFK(bot, movement, userId) {
  switch (movement) {
    case 'jump':
      bot.setControlState('jump', true);
      break;
    case 'walk':
      bot.setControlState('forward', true);
      setInterval(() => bot.look(Math.random() * Math.PI, Math.random() * Math.PI), 5000);
      break;
    case 'sneak':
      bot.setControlState('sneak', true);
      break;
    case 'circle':
      bot.setControlState('forward', true);
      let angle = 0;
      setInterval(() => {
        angle += 0.1;
        bot.look(angle, 0);
      }, 50);
      break;
  }
  io.to(userId).emit('message', `Anti-AFK started with movement: ${movement}`);
}

// Remove bot
function removeBot(userId) {
  if (bots.has(userId)) {
    const botData = bots.get(userId);
    if (botData.msg_timer) clearInterval(botData.msg_timer);
    botData.bot.quit();
    bots.delete(userId);
    const ip = Object.keys(ipBots).find(ip => ipBots[ip].has(userId));
    if (ip) ipBots[ip].delete(userId);
  }
  if (timers.has(userId)) {
    clearInterval(timers.get(userId).interval);
    timers.delete(userId);
  }
}

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = dummyUsers.get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    users.set(req.ip, username);
    res.json({ success: true, userId: req.ip });
  } else {
    res.status(401).json({ success: false, message: 'Invalid login or password' });
  }
});

// Socket.IO middleware for IP and VPN check
io.use((socket, next) => {
  const userId = socket.handshake.address;
  const ip = socket.handshake.address;

  // Simple VPN check (basic proxy detection)
  if (ip.includes('unknown') || ip.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/)) {
    socket.emit('message', 'VPN or proxy detected, access denied!');
    socket.disconnect(true);
    return;
  }

  // One bot per IP limit
  if (ipBots.has(ip) && ipBots.get(ip).size >= 1) {
    socket.emit('message', 'Only one bot allowed per IP!');
    socket.disconnect(true);
    return;
  }

  if (users.has(userId)) {
    socket.userId = userId;
    startTimer(userId);
    if (!ipBots.has(ip)) ipBots.set(ip, new Set());
    ipBots.get(ip).add(userId);
    next();
  } else {
    socket.emit('message', 'Please log in first!');
    socket.disconnect(true);
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;

  socket.on('addBot', (config) => {
    if (!bots.has(userId)) {
      createBot(userId, config);
      dummyUsers.get(users.get(userId)).bots.set(userId, config);
      socket.emit('message', `Bot started: ${config['bot-account']['username'] || 'CrackedBot'}`);
    } else {
      socket.emit('message', 'You already have a bot running!');
    }
  });

  socket.on('command', (command) => {
    if (bots.has(userId)) {
      bots.get(userId).bot.chat(command);
      socket.emit('message', `Command sent: ${command}`);
    }
  });

  socket.on('removeBot', () => {
    removeBot(userId);
    dummyUsers.get(users.get(userId)).bots.delete(userId);
    socket.emit('message', 'Bot stopped');
  });

  socket.on('disconnect', () => {
    removeBot(userId);
  });
});

const port = process.env.PORT || 8000;
server.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});