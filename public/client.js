const socket = io();
let currentRoom = null;
let username = null;
let isHost = false; // Pour suivre si l'utilisateur est l'hôte
let selectedFile = null;
let sharedAudio = null;
let audioContext = null;
let sharedAudioAnalyser = null;
let sharedAudioSource = null;
let spectrumAnimationId = null;
let isAudioPlaying = false;
let isMuted = false;

// Ajout des variables pour la gestion du ping
let pingStartTime = 0;
let latency = 0;

// Variables pour WebRTC
let localStream = null;
let peerConnections = new Map(); // Pour stocker les connexions avec les autres utilisateurs

// Ajoutons une Map pour suivre qui est en appel
const usersInCall = new Set();

// Ajout des variables pour l'analyse audio
let audioAnalyser;
let dataArray;
let animationFrameId;

// Au début du fichier, après la déclaration du socket
if (window.ENV && window.ENV.isDevelopment) {
    socket.on("disconnect", () => {
        console.log("Déconnecté du serveur, tentative de reconnexion...");
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    });
}

function setUsername() {
    const usernameInput = document.getElementById("username");
    username = usernameInput.value.trim();

    if (username) {
        socket.emit("set_username", username);
    }
}

socket.on("username_set", () => {
    document.getElementById("username-form").style.display = "none";
    document.getElementById("room-interface").style.display = "block";
});

function createRoom() {
    const roomName = document.getElementById("room-name").value.trim();
    if (roomName) {
        socket.emit("create_room", roomName);
        joinRoom(roomName);
    }
}

function joinRoom(roomName) {
    currentRoom = roomName;
    socket.emit("join_room", roomName);
    document.getElementById("room-interface").style.display = "none";
    document.getElementById("call-controls").style.display = "block";
    document.getElementById("connected-users").innerHTML = "";
    document.getElementById(
        "current-room-name"
    ).textContent = `Salle : ${roomName}`;
}

socket.on("rooms_list", (rooms) => {
    const roomsList = document.getElementById("rooms-list");
    roomsList.innerHTML = "";

    rooms.forEach((room) => {
        const li = document.createElement("li");
        li.className = "room-item";
        li.innerHTML = `
            ${room}
            <button onclick="joinRoom('${room}')">Rejoindre</button>
        `;
        roomsList.appendChild(li);
    });
});

socket.on("user_joined", (username) => {
    console.log(`${username} a rejoint la room ${currentRoom}`);
});

// Gestion du ping/pong
socket.on("ping", () => {
    pingStartTime = Date.now();
    socket.emit("ping");
});

socket.on("pong", () => {
    latency = Date.now() - pingStartTime;
    socket.emit("latency", latency);
});

// Mise à jour de la liste des utilisateurs
socket.on("users_update", (users) => {
    const usersList = document.getElementById("connected-users");
    usersList.innerHTML = "";

    users.forEach((user) => {
        const li = document.createElement("li");
        li.className = "user-item";

        // Déterminer la couleur en fonction du niveau
        let color;
        const level = user.voiceLevel || 0;
        if (level < 40) {
            color = "#4caf50"; // Vert pour niveau normal
        } else if (level < 70) {
            color = "#ffc107"; // Jaune pour niveau moyen
        } else {
            color = "#f44336"; // Rouge pour niveau élevé
        }

        li.innerHTML = `
            <div class="user-info">
                <div class="voice-indicator ${
                    usersInCall.has(user.username) ? "active" : ""
                }"></div>
                <span class="username">${user.username}</span>
                ${user.isHost ? '<span class="host-crown">👑</span>' : ""}
                <div class="voice-level">
                    <div class="voice-level-bar" style="height: ${level}%; background-color: ${color}"></div>
                </div>
            </div>
            <span class="latency ${getLatencyClass(user.latency)}">${
            user.latency
        }ms</span>
        `;
        usersList.appendChild(li);
    });
});

// Fonction utilitaire pour déterminer la classe CSS en fonction de la latence
function getLatencyClass(latency) {
    if (latency < 100) return "latency-good";
    if (latency < 200) return "latency-medium";
    return "latency-bad";
}

// Fonction pour démarrer l'appel
async function startCall() {
    try {
        // Demander l'accès au microphone
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
        });

        // Informer le serveur que nous sommes prêts à démarrer l'appel
        socket.emit("ready_to_call", currentRoom);
        socket.emit("user_started_call", currentRoom);

        // Activer le bouton stop
        document.querySelector('button[onclick="startCall()"]').disabled = true;
        document.querySelector('button[onclick="stopCall()"]').disabled = false;

        usersInCall.add(username);
        updateUsersDisplay();

        // Configurer l'analyseur audio
        audioContext = new AudioContext();
        const audioSource = audioContext.createMediaStreamSource(localStream);
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        audioSource.connect(audioAnalyser);

        dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

        // Démarrer l'analyse du niveau vocal
        analyzeAudio();
    } catch (err) {
        console.error("Erreur lors de l'accès au microphone:", err);
        alert("Impossible d'accéder au microphone. Vérifiez les permissions.");
    }
}

// Nouvelle fonction pour analyser l'audio
function analyzeAudio() {
    audioAnalyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const normalizedValue = Math.min(100, (average / 128) * 100);

    // Envoyer le niveau vocal au serveur
    socket.emit("voice_level", {
        level: normalizedValue,
        room: currentRoom,
    });

    animationFrameId = requestAnimationFrame(analyzeAudio);
}

// Fonction pour arrêter l'appel
function stopCall() {
    if (localStream) {
        // Arrêter toutes les pistes audio
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;

        // Fermer toutes les connexions peer
        peerConnections.forEach((pc, userId) => {
            pc.close();
        });
        peerConnections.clear();

        // Informer le serveur que nous arrêtons l'appel
        socket.emit("stop_call", currentRoom);
        socket.emit("user_stopped_call", currentRoom);

        // Réactiver le bouton start et désactiver le bouton stop
        document.querySelector(
            'button[onclick="startCall()"]'
        ).disabled = false;
        document.querySelector('button[onclick="stopCall()"]').disabled = true;

        usersInCall.delete(username);
        updateUsersDisplay();

        // Arrêter l'analyse audio
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        if (audioContext) {
            audioContext.close();
        }
    }
}

// Gestionnaire d'événements WebRTC
socket.on("user_ready_to_call", async (userId) => {
    if (!localStream) return;

    try {
        // Créer une nouvelle connexion peer
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        // Ajouter la stream locale
        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });

        // Gérer les candidats ICE
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("ice_candidate", {
                    candidate: event.candidate,
                    targetUserId: userId,
                });
            }
        };

        // Gérer la réception des streams distants
        pc.ontrack = (event) => {
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play();
        };

        // Créer et envoyer l'offre
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("call_offer", {
            offer: offer,
            targetUserId: userId,
        });

        peerConnections.set(userId, pc);
    } catch (err) {
        console.error("Erreur lors de l'établissement de la connexion:", err);
    }
});

socket.on("call_offer", async ({ offer, userId }) => {
    if (!localStream) return;

    try {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("ice_candidate", {
                    candidate: event.candidate,
                    targetUserId: userId,
                });
            }
        };

        pc.ontrack = (event) => {
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play();
        };

        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("call_answer", {
            answer: answer,
            targetUserId: userId,
        });

        peerConnections.set(userId, pc);
    } catch (err) {
        console.error("Erreur lors de la réponse à l'offre:", err);
    }
});

socket.on("call_answer", async ({ answer, userId }) => {
    const pc = peerConnections.get(userId);
    if (pc) {
        await pc.setRemoteDescription(answer);
    }
});

socket.on("ice_candidate", async ({ candidate, userId }) => {
    const pc = peerConnections.get(userId);
    if (pc) {
        await pc.addIceCandidate(candidate);
    }
});

socket.on("user_stopped_call", (userId) => {
    const pc = peerConnections.get(userId);
    if (pc) {
        pc.close();
        peerConnections.delete(userId);
    }
});

// Ajoutons la gestion des utilisateurs en appel
socket.on("user_ready_to_call", (userId) => {
    if (!localStream) return;
    // ... code existant ...

    // Ajoutons l'utilisateur à la liste des personnes en appel
    socket.emit("user_started_call", currentRoom);
});

// Ajoutons les événements pour suivre qui est en appel
socket.on("user_started_call", (username) => {
    usersInCall.add(username);
    updateUsersDisplay();
});

socket.on("user_stopped_call", (username) => {
    usersInCall.delete(username);
    updateUsersDisplay();
});

// Fonction helper pour mettre à jour l'affichage
function updateUsersDisplay() {
    const users = Array.from(document.querySelectorAll(".user-item")).forEach(
        (item) => {
            const username = item.querySelector(".username").textContent;
            const indicator = item.querySelector(".voice-indicator");
            if (usersInCall.has(username)) {
                indicator.classList.add("active");
            } else {
                indicator.classList.remove("active");
            }
        }
    );
}

// Modification de la fonction leaveRoom pour nettoyer l'appel
function leaveRoom() {
    if (currentRoom) {
        stopCall();
        socket.emit("leave_room", currentRoom);
        currentRoom = null;
        isHost = false;

        // Nettoyer l'audio partagé
        if (sharedAudio) {
            sharedAudio.pause();
            sharedAudio = null;
        }
        if (sharedAudioSource) {
            sharedAudioSource.disconnect();
            sharedAudioSource = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        stopSpectrum();
        showAudioPlayingIndicator(false);
        selectedFile = null;
        isMuted = false;

        document.getElementById("call-controls").style.display = "none";
        document.getElementById("room-interface").style.display = "block";
        document.getElementById("file-controls").style.display = "none";
        disableAudioControls();

        const hostMessage = document.querySelector(".host-message");
        if (hostMessage) {
            hostMessage.remove();
        }
    }
}

socket.on("you_are_host", () => {
    isHost = true;
    const roomHeader = document.querySelector(".room-header");
    const hostMessage = document.createElement("span");
    hostMessage.className = "host-message";
    hostMessage.textContent = "Vous êtes l'hôte";
    roomHeader.insertBefore(
        hostMessage,
        roomHeader.querySelector(".leave-btn")
    );

    // Afficher les contrôles de fichier pour l'hôte
    document.getElementById("file-controls").style.display = "block";
});

socket.on("new_host", (newHost) => {
    if (newHost === username) {
        isHost = true;
        document.getElementById("file-controls").style.display = "block";
        const roomHeader = document.querySelector(".room-header");
        const hostMessage = document.createElement("span");
        hostMessage.className = "host-message";
        hostMessage.textContent = "Vous êtes l'hôte";
        roomHeader.insertBefore(
            hostMessage,
            roomHeader.querySelector(".leave-btn")
        );
    }
});

// Gestion de l'upload de fichiers
function handleFileUpload(event) {
    selectedFile = event.target.files[0];
    document.getElementById("upload-btn").disabled = false;
}

async function uploadFile() {
    if (!selectedFile || !currentRoom) return;

    const formData = new FormData();
    formData.append("audio", selectedFile);

    try {
        const response = await fetch(`/upload/${currentRoom}`, {
            method: "POST",
            body: formData,
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById("upload-btn").disabled = true;
            enableAudioControls();
        }
    } catch (error) {
        console.error("Erreur lors de l'upload:", error);
    }
}

function enableAudioControls() {
    document.getElementById("play-btn").disabled = false;
    document.getElementById("pause-btn").disabled = false;
    document.getElementById("stop-btn").disabled = false;
    document.getElementById("mute-btn").disabled = false;
}

function disableAudioControls() {
    document.getElementById("play-btn").disabled = true;
    document.getElementById("pause-btn").disabled = true;
    document.getElementById("stop-btn").disabled = true;
    document.getElementById("mute-btn").disabled = true;
}

function toggleMute() {
    if (!sharedAudio) return;

    isMuted = !isMuted;
    sharedAudio.muted = isMuted;

    const muteBtn = document.getElementById("mute-btn");
    muteBtn.textContent = isMuted ? "🔇" : "🔊";
    muteBtn.classList.toggle("muted", isMuted);
}

// Gestion de la lecture audio
socket.on("file_uploaded", (filename) => {
    if (sharedAudio) {
        sharedAudio.pause();
        sharedAudio = null;
    }

    sharedAudio = new Audio(`/uploads/${filename}`);
    sharedAudio.muted = isMuted;
    showAudioPlayingIndicator(false);

    if (isHost) {
        enableAudioControls();
    }

    // Initialiser l'analyseur audio
    setupAudioAnalyser();

    // Ajouter un écouteur pour la fin de l'audio
    sharedAudio.addEventListener("ended", () => {
        showAudioPlayingIndicator(false);
        stopSpectrum();
    });
});

function setupAudioAnalyser() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }

    if (sharedAudioSource) {
        sharedAudioSource.disconnect();
    }

    sharedAudioSource = audioContext.createMediaElementSource(sharedAudio);
    sharedAudioAnalyser = audioContext.createAnalyser();
    sharedAudioAnalyser.fftSize = 256;

    sharedAudioSource.connect(sharedAudioAnalyser);
    sharedAudioAnalyser.connect(audioContext.destination);
}

function drawSpectrum() {
    if (!sharedAudioAnalyser) return;

    const canvas = document.getElementById("audio-spectrum");
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const bufferLength = sharedAudioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        spectrumAnimationId = requestAnimationFrame(draw);

        sharedAudioAnalyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = (dataArray[i] / 255) * height;

            const hue = (i / bufferLength) * 360;
            ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    // Ajuster la taille du canvas
    function resizeCanvas() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    draw();
}

function stopSpectrum() {
    if (spectrumAnimationId) {
        cancelAnimationFrame(spectrumAnimationId);
        spectrumAnimationId = null;

        // Effacer le canvas
        const canvas = document.getElementById("audio-spectrum");
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function handleAudioCommand(action) {
    if (!sharedAudio) return;

    switch (action) {
        case "play":
            sharedAudio.play();
            if (audioContext && audioContext.state === "suspended") {
                audioContext.resume();
            }
            drawSpectrum();
            showAudioPlayingIndicator(true);
            break;
        case "pause":
            sharedAudio.pause();
            stopSpectrum();
            showAudioPlayingIndicator(false);
            break;
        case "stop":
            sharedAudio.pause();
            sharedAudio.currentTime = 0;
            stopSpectrum();
            showAudioPlayingIndicator(false);
            break;
    }
}

function showAudioPlayingIndicator(show) {
    const indicator = document.getElementById("audio-playing-indicator");
    indicator.style.display = show ? "inline-block" : "none";
    isAudioPlaying = show;
}

function broadcastAudio(action) {
    if (!isHost || !currentRoom) return;

    socket.emit("broadcast_audio", { action, room: currentRoom });
    handleAudioCommand(action);
}

socket.on("audio_command", (action) => {
    handleAudioCommand(action);
});
