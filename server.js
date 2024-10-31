const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

const rooms = new Map();
const userPings = new Map();

io.on('connection', (socket) => {
    let pingInterval;
    
    socket.on('ping', () => {
        socket.emit('pong');
    });

    socket.on('latency', (latency) => {
        if (socket.username && socket.roomName) {
            userPings.set(socket.username, latency);
            io.to(socket.roomName).emit('users_update', Array.from(rooms.get(socket.roomName)).map(username => ({
                username,
                latency: userPings.get(username) || 0
            })));
        }
    });

    socket.on('set_username', (username) => {
        socket.username = username;
        socket.emit('username_set');
        io.emit('rooms_list', Array.from(rooms.keys()));
    });

    socket.on('create_room', (roomName) => {
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Set());
            io.emit('rooms_list', Array.from(rooms.keys()));
        }
    });

    socket.on('join_room', (roomName) => {
        if (rooms.has(roomName)) {
            socket.roomName = roomName;
            socket.join(roomName);
            rooms.get(roomName).add(socket.username);
            io.to(roomName).emit('user_joined', socket.username);
            
            io.to(roomName).emit('users_update', Array.from(rooms.get(roomName)).map(username => ({
                username,
                latency: userPings.get(username) || 0
            })));

            pingInterval = setInterval(() => {
                socket.emit('ping');
            }, 2000);
        }
    });

    socket.on('leave_room', (roomName) => {
        if (rooms.has(roomName)) {
            socket.leave(roomName);
            rooms.get(roomName).delete(socket.username);
            
            if (rooms.get(roomName).size === 0) {
                rooms.delete(roomName);
                io.emit('rooms_list', Array.from(rooms.keys()));
            } else {
                io.to(roomName).emit('users_update', Array.from(rooms.get(roomName)).map(username => ({
                    username,
                    latency: userPings.get(username) || 0
                })));
            }

            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            
            userPings.delete(socket.username);
            
            socket.roomName = null;
        }
    });

    socket.on('disconnect', () => {
        if (pingInterval) {
            clearInterval(pingInterval);
        }
        
        if (socket.username) {
            userPings.delete(socket.username);
        }

        rooms.forEach((users, roomName) => {
            if (users.has(socket.username)) {
                users.delete(socket.username);
                if (users.size === 0) {
                    rooms.delete(roomName);
                } else {
                    io.to(roomName).emit('users_update', Array.from(users).map(username => ({
                        username,
                        latency: userPings.get(username) || 0
                    })));
                }
            }
        });
        io.emit('rooms_list', Array.from(rooms.keys()));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});