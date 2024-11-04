const socket = io()
let currentRoom = null
let username = null

// Ajout des variables pour la gestion du ping
let pingStartTime = 0
let latency = 0

// Variables pour WebRTC
let localStream = null
let peerConnections = new Map() // Pour stocker les connexions avec les autres utilisateurs

// Ajoutons une Map pour suivre qui est en appel
const usersInCall = new Set()

// Ajout des variables pour l'analyse audio
let audioContext
let audioAnalyser
let dataArray
let animationFrameId

// Au début du fichier, après la déclaration du socket
if (window.ENV && window.ENV.isDevelopment) {
    socket.on('disconnect', () => {
        console.log('Déconnecté du serveur, tentative de reconnexion...')
        setTimeout(() => {
            window.location.reload()
        }, 1000)
    })
}

function setUsername() {
    const usernameInput = document.getElementById('username')
    username = usernameInput.value.trim()

    if (username) {
        socket.emit('set_username', username)
    }
}

socket.on('username_set', () => {
    document.getElementById('username-form').style.display = 'none'
    document.getElementById('room-interface').style.display = 'block'
})

function createRoom() {
    const roomName = document.getElementById('room-name').value.trim()
    if (roomName) {
        socket.emit('create_room', roomName)
        joinRoom(roomName)
    }
}

function joinRoom(roomName) {
    currentRoom = roomName
    socket.emit('join_room', roomName)
    document.getElementById('room-interface').style.display = 'none'
    document.getElementById('call-controls').style.display = 'block'
    document.getElementById('connected-users').innerHTML = ''
    document.getElementById(
        'current-room-name'
    ).textContent = `Salle : ${roomName}`
}

socket.on('rooms_list', (rooms) => {
    const roomsList = document.getElementById('rooms-list')
    roomsList.innerHTML = ''

    rooms.forEach((room) => {
        const li = document.createElement('li')
        li.className = 'room-item'
        li.innerHTML = `
            ${room}
            <button onclick="joinRoom('${room}')">Rejoindre</button>
        `
        roomsList.appendChild(li)
    })
})

socket.on('user_joined', (username) => {
    console.log(`${username} a rejoint la room ${currentRoom}`)
})

// Gestion du ping/pong
socket.on('ping', () => {
    pingStartTime = Date.now()
    socket.emit('ping')
})

socket.on('pong', () => {
    latency = Date.now() - pingStartTime
    socket.emit('latency', latency)
})

// Mise à jour de la liste des utilisateurs
socket.on('users_update', (users) => {
    const usersList = document.getElementById('connected-users')
    usersList.innerHTML = ''

    users.forEach((user) => {
        const li = document.createElement('li')
        li.className = 'user-item'

        // Déterminer la couleur en fonction du niveau
        let color
        const level = user.voiceLevel || 0
        if (level < 40) {
            color = '#4caf50' // Vert pour niveau normal
        } else if (level < 70) {
            color = '#ffc107' // Jaune pour niveau moyen
        } else {
            color = '#f44336' // Rouge pour niveau élevé
        }

        li.innerHTML = `
            <div class="user-info">
                <div class="voice-indicator ${
                    usersInCall.has(user.username) ? 'active' : ''
                }"></div>
                <span class="username">${user.username}</span>
                <div class="voice-level">
                    <div class="voice-level-bar" style="height: ${level}%; background-color: ${color}"></div>
                </div>
            </div>
            <span class="latency ${getLatencyClass(user.latency)}">${
            user.latency
        }ms</span>
        `
        usersList.appendChild(li)
    })
})

// Fonction utilitaire pour déterminer la classe CSS en fonction de la latence
function getLatencyClass(latency) {
    if (latency < 100) return 'latency-good'
    if (latency < 200) return 'latency-medium'
    return 'latency-bad'
}

// Fonction pour démarrer l'appel
async function startCall() {
    try {
        // Demander l'accès au microphone
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
        })

        // Informer le serveur que nous sommes prêts à démarrer l'appel
        socket.emit('ready_to_call', currentRoom)
        socket.emit('user_started_call', currentRoom)

        // Activer le bouton stop
        document.querySelector('button[onclick="startCall()"]').disabled = true
        document.querySelector('button[onclick="stopCall()"]').disabled = false

        usersInCall.add(username)
        updateUsersDisplay()

        // Configurer l'analyseur audio
        audioContext = new AudioContext()
        const audioSource = audioContext.createMediaStreamSource(localStream)
        audioAnalyser = audioContext.createAnalyser()
        audioAnalyser.fftSize = 256
        audioSource.connect(audioAnalyser)

        dataArray = new Uint8Array(audioAnalyser.frequencyBinCount)

        // Démarrer l'analyse du niveau vocal
        analyzeAudio()
    } catch (err) {
        console.error("Erreur lors de l'accès au microphone:", err)
        alert("Impossible d'accéder au microphone. Vérifiez les permissions.")
    }
}

// Nouvelle fonction pour analyser l'audio
function analyzeAudio() {
    audioAnalyser.getByteFrequencyData(dataArray)
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length
    const normalizedValue = Math.min(100, (average / 128) * 100)

    // Envoyer le niveau vocal au serveur
    socket.emit('voice_level', {
        level: normalizedValue,
        room: currentRoom,
    })

    animationFrameId = requestAnimationFrame(analyzeAudio)
}

// Fonction pour arrêter l'appel
function stopCall() {
    if (localStream) {
        // Arrêter toutes les pistes audio
        localStream.getTracks().forEach((track) => track.stop())
        localStream = null

        // Fermer toutes les connexions peer
        peerConnections.forEach((pc, userId) => {
            pc.close()
        })
        peerConnections.clear()

        // Informer le serveur que nous arrêtons l'appel
        socket.emit('stop_call', currentRoom)
        socket.emit('user_stopped_call', currentRoom)

        // Réactiver le bouton start et désactiver le bouton stop
        document.querySelector('button[onclick="startCall()"]').disabled = false
        document.querySelector('button[onclick="stopCall()"]').disabled = true

        usersInCall.delete(username)
        updateUsersDisplay()

        // Arrêter l'analyse audio
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId)
        }
        if (audioContext) {
            audioContext.close()
        }
    }
}

// Gestionnaire d'événements WebRTC
socket.on('user_ready_to_call', async (userId) => {
    if (!localStream) return

    try {
        // Créer une nouvelle connexion peer
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        })

        // Ajouter la stream locale
        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream)
        })

        // Gérer les candidats ICE
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    candidate: event.candidate,
                    targetUserId: userId,
                })
            }
        }

        // Gérer la réception des streams distants
        pc.ontrack = (event) => {
            const remoteAudio = new Audio()
            remoteAudio.srcObject = event.streams[0]
            remoteAudio.play()
        }

        // Créer et envoyer l'offre
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        socket.emit('call_offer', {
            offer: offer,
            targetUserId: userId,
        })

        peerConnections.set(userId, pc)
    } catch (err) {
        console.error("Erreur lors de l'établissement de la connexion:", err)
    }
})

socket.on('call_offer', async ({ offer, userId }) => {
    if (!localStream) return

    try {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        })

        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream)
        })

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    candidate: event.candidate,
                    targetUserId: userId,
                })
            }
        }

        pc.ontrack = (event) => {
            const remoteAudio = new Audio()
            remoteAudio.srcObject = event.streams[0]
            remoteAudio.play()
        }

        await pc.setRemoteDescription(offer)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        socket.emit('call_answer', {
            answer: answer,
            targetUserId: userId,
        })

        peerConnections.set(userId, pc)
    } catch (err) {
        console.error("Erreur lors de la réponse à l'offre:", err)
    }
})

socket.on('call_answer', async ({ answer, userId }) => {
    const pc = peerConnections.get(userId)
    if (pc) {
        await pc.setRemoteDescription(answer)
    }
})

socket.on('ice_candidate', async ({ candidate, userId }) => {
    const pc = peerConnections.get(userId)
    if (pc) {
        await pc.addIceCandidate(candidate)
    }
})

socket.on('user_stopped_call', (userId) => {
    const pc = peerConnections.get(userId)
    if (pc) {
        pc.close()
        peerConnections.delete(userId)
    }
})

// Ajoutons la gestion des utilisateurs en appel
socket.on('user_ready_to_call', (userId) => {
    if (!localStream) return
    // ... code existant ...

    // Ajoutons l'utilisateur à la liste des personnes en appel
    socket.emit('user_started_call', currentRoom)
})

// Ajoutons les événements pour suivre qui est en appel
socket.on('user_started_call', (username) => {
    usersInCall.add(username)
    updateUsersDisplay()
})

socket.on('user_stopped_call', (username) => {
    usersInCall.delete(username)
    updateUsersDisplay()
})

// Fonction helper pour mettre à jour l'affichage
function updateUsersDisplay() {
    const users = Array.from(document.querySelectorAll('.user-item')).forEach(
        (item) => {
            const username = item.querySelector('.username').textContent
            const indicator = item.querySelector('.voice-indicator')
            if (usersInCall.has(username)) {
                indicator.classList.add('active')
            } else {
                indicator.classList.remove('active')
            }
        }
    )
}

// Modification de la fonction leaveRoom pour nettoyer l'appel
function leaveRoom() {
    if (currentRoom) {
        stopCall() // Arrêter l'appel avant de quitter la room
        socket.emit('leave_room', currentRoom)
        currentRoom = null
        document.getElementById('call-controls').style.display = 'none'
        document.getElementById('room-interface').style.display = 'block'
    }
}
