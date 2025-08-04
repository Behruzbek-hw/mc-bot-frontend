const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const PORT = 8000;

const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
});

const io = new Server(server);

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('startBot', (data) => {
        const bot = mineflayer.createBot({
            host: data.serverIP,
            port: data.serverPort ? parseInt(data.serverPort) : 25565,
            username: data.botName || 'Bot_' + Math.random().toString(36).substr(2, 5),
            version: data.version
        });

        bot.on('login', () => {
            console.log('Bot logged in');
            if (data.antiAFK === 'Jump') {
                setInterval(() => bot.setControlState('jump', true), 5000);
            } else if (data.antiAFK === 'Sneak') {
                setInterval(() => bot.setControlState('sneak', true), 5000);
            } else if (data.antiAFK === 'Sneak + Jump') {
                setInterval(() => {
                    bot.setControlState('sneak', true);
                    bot.setControlState('jump', true);
                }, 5000);
            }
        });

        bot.on('end', () => {
            console.log('Bot disconnected');
        });

        socket.on('stopBot', () => {
            bot.end();
        });

        socket.on('disconnect', () => {
            bot.end();
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
