const socket = io();
let currentRoom = null;
let username = null;

// Ajout des variables pour la gestion du ping
let pingStartTime = 0;
let latency = 0;

// Au début du fichier, après la déclaration du socket
if (window.ENV && window.ENV.isDevelopment) {
    socket.on('disconnect', () => {
        console.log('Déconnecté du serveur, tentative de reconnexion...');
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    });
}

function setUsername() {
    const usernameInput = document.getElementById('username');
    username = usernameInput.value.trim();
    
    if (username) {
        socket.emit('set_username', username);
    }
}

socket.on('username_set', () => {
    document.getElementById('username-form').style.display = 'none';
    document.getElementById('room-interface').style.display = 'block';
});

function createRoom() {
    const roomName = document.getElementById('room-name').value.trim();
    if (roomName) {
        socket.emit('create_room', roomName);
        joinRoom(roomName);
    }
}

function joinRoom(roomName) {
    currentRoom = roomName;
    socket.emit('join_room', roomName);
    document.getElementById('room-interface').style.display = 'none';
    document.getElementById('call-controls').style.display = 'block';
    document.getElementById('connected-users').innerHTML = '';
    document.getElementById('current-room-name').textContent = `Salle : ${roomName}`;
}

socket.on('rooms_list', (rooms) => {
    const roomsList = document.getElementById('rooms-list');
    roomsList.innerHTML = '';
    
    rooms.forEach(room => {
        const li = document.createElement('li');
        li.className = 'room-item';
        li.innerHTML = `
            ${room}
            <button onclick="joinRoom('${room}')">Rejoindre</button>
        `;
        roomsList.appendChild(li);
    });
});

socket.on('user_joined', (username) => {
    console.log(`${username} a rejoint la room ${currentRoom}`);
});

// Gestion du ping/pong
socket.on('ping', () => {
    pingStartTime = Date.now();
    socket.emit('ping');
});

socket.on('pong', () => {
    latency = Date.now() - pingStartTime;
    socket.emit('latency', latency);
});

// Mise à jour de la liste des utilisateurs
socket.on('users_update', (users) => {
    const usersList = document.getElementById('connected-users');
    usersList.innerHTML = '';
    
    users.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        li.innerHTML = `
            <span class="username">${user.username}</span>
            <span class="latency ${getLatencyClass(user.latency)}">${user.latency}ms</span>
        `;
        usersList.appendChild(li);
    });
});

// Fonction utilitaire pour déterminer la classe CSS en fonction de la latence
function getLatencyClass(latency) {
    if (latency < 100) return 'latency-good';
    if (latency < 200) return 'latency-medium';
    return 'latency-bad';
}

function leaveRoom() {
    if (currentRoom) {
        socket.emit('leave_room', currentRoom);
        currentRoom = null;
        document.getElementById('call-controls').style.display = 'none';
        document.getElementById('room-interface').style.display = 'block';
    }
}