// ==========================================
// ESTADO GLOBAL
// ==========================================
let myName = "";
let myPeer = null;
let myId = "";
let roomCode = "";
let isHost = false;
let connections = [];
let players = [];
let hostConn = null;
let currentGame = null;
let adivina = { secreto: null, activo: false, ganador: null };
let raceResults = [];
let cars = {}; // Para guardar la posición de todos los autos en la carrera

// Paleta de colores para los autos
const COLORS = ["#e63946", "#4cc9f0", "#3ecf8e", "#f9c74f", "#9d4edd", "#f9844a"];

// ✅ FIX: Configuración de servidores STUN para conectar entre diferentes redes
const peerConfig = {
  config: {
    'iceServers': [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  }
};

// ==========================================
// SISTEMA DE MÚSICA
// ==========================================
let bgMusic = new Audio();
let musicStarted = false;
let isMuted = true; // Empieza muteado hasta que toquen "Continuar"

function playRandomSong() {
  if (typeof playlist === 'undefined' || !playlist || playlist.length === 0) return;
  
  const randomIndex = Math.floor(Math.random() * playlist.length);
  bgMusic.src = playlist[randomIndex];
  bgMusic.volume = 0.5;
  bgMusic.play().catch(e => console.log("Esperando interacción para reproducir audio..."));
}

// Cuando la canción termina, pasa a otra aleatoria
bgMusic.addEventListener('ended', playRandomSong);

function iniciarMusica() {
  if (musicStarted) return;
  musicStarted = true;
  isMuted = false;
  document.getElementById("btn-music").textContent = "🔊";
  playRandomSong();
}

function toggleMusic() {
  const btn = document.getElementById("btn-music");
  if (isMuted) {
    isMuted = false;
    btn.textContent = "🔊";
    if (!musicStarted) {
      iniciarMusica();
    } else {
      bgMusic.play();
    }
  } else {
    isMuted = true;
    btn.textContent = "🔇";
    bgMusic.pause();
  }
}

// ==========================================
// NAVEGACIÓN
// ==========================================
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`screen-${name}`).classList.add("active");
}

// ==========================================
// LOGIN Y LOBBY
// ==========================================
function entrarLobby() {
  const name = document.getElementById("nickname-input").value.trim();
  if (name.length < 2) {
    document.getElementById("login-error").textContent = "El nombre debe tener al menos 2 caracteres";
    return;
  }
  myName = name;
  document.getElementById("login-error").textContent = "";
  document.getElementById("lobby-nickname").textContent = name;
  showScreen("lobby");
  document.getElementById("join-code").focus();
  
  iniciarMusica(); // ✅ Arranca la música porque el usuario ya hizo clic
}

document.getElementById("nickname-input").addEventListener("keypress", e => {
  if (e.key === "Enter") entrarLobby();
});
document.getElementById("join-code").addEventListener("keypress", e => {
  if (e.key === "Enter") unirseSala();
});

// ==========================================
// CREAR SALA (HOST)
// ==========================================
function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function crearSala() {
  document.getElementById("lobby-info").textContent = "Creando sala...";
  document.getElementById("lobby-error").textContent = "";
  document.getElementById("btn-crear").disabled = true;

  roomCode = genCode();
  isHost = true;
  players = [];
  connections = [];
  cars = {};

  // ✅ FIX: Se pasa la configuración STUN
  myPeer = new Peer(roomCode, peerConfig);

  myPeer.on("open", id => {
    myId = id;
    roomCode = id;
    // El host siempre es el color 0 (Rojo)
    players = [{ peerId: id, name: myName, color: COLORS[0] }];
    document.getElementById("btn-crear").disabled = false;
    document.getElementById("lobby-info").textContent = "";
    entrarSala();
  });

  myPeer.on("connection", conn => {
    connections.push(conn);
    conn.on("data", data => handleDataAsHost(data, conn));
    conn.on("close", () => {
      players = players.filter(p => p.peerId !== conn.peer);
      delete cars[conn.peer];
      connections = connections.filter(c => c !== conn);
      updatePlayersUI();
      broadcastPlayers();
      broadcastCars(); // Avisar a los demás para que borren el auto fantasma
    });
  });

  myPeer.on("error", err => {
    document.getElementById("btn-crear").disabled = false;
    if (err.type === "unavailable-id") { myPeer.destroy(); crearSala(); }
    else { document.getElementById("lobby-error").textContent = "Error: " + err.type; document.getElementById("lobby-info").textContent = ""; }
  });
}

// ==========================================
// UNIRSE (GUEST)
// ==========================================
function unirseSala() {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (code.length !== 6) {
    document.getElementById("lobby-error").textContent = "El código debe tener 6 caracteres";
    return;
  }
  document.getElementById("lobby-info").textContent = "Conectando...";
  document.getElementById("lobby-error").textContent = "";
  roomCode = code; isHost = false;
  
  myPeer = new Peer(peerConfig);

  // Timeout de 15 segundos por si la red bloquea la conexión
  let timeoutId = setTimeout(() => {
    if (!hostConn || !hostConn.open) {
      document.getElementById("lobby-error").textContent = "Tiempo de espera agotado. Revisá el código o que el Host esté en línea.";
      document.getElementById("lobby-info").textContent = "";
      if (myPeer) { myPeer.destroy(); myPeer = null; }
    }
  }, 15000);

  myPeer.on("open", id => {
    myId = id;
    hostConn = myPeer.connect(code);
    
    hostConn.on("open", () => {
      clearTimeout(timeoutId);
      hostConn.send({ type: "name", name: myName });
      document.getElementById("lobby-info").textContent = "";
      entrarSala();
    });
    
    hostConn.on("data", data => handleDataAsGuest(data));
    
    hostConn.on("close", () => { 
      clearTimeout(timeoutId);
      alert("El host cerró la sala o se perdió la conexión"); 
      salirSala(); 
    });

    hostConn.on("error", (err) => {
      clearTimeout(timeoutId);
      console.error("Error en hostConn:", err);
      document.getElementById("lobby-error").textContent = "Error al conectar con el Host.";
      document.getElementById("lobby-info").textContent = "";
      if (myPeer) { myPeer.destroy(); myPeer = null; }
    });
  });

  myPeer.on("error", err => {
    clearTimeout(timeoutId);
    console.error("Error en myPeer:", err);
    document.getElementById("lobby-error").textContent = "Error de red: " + err.type;
    document.getElementById("lobby-info").textContent = "";
    if (myPeer) { myPeer.destroy(); myPeer = null; }
  });
}

// ==========================================
// MANEJO DE DATOS
// ==========================================
function handleDataAsHost(data, conn) {
  switch (data.type) {
    case "name":
      // Asignar un color basado en cuántos jugadores hay
      const color = COLORS[players.length % COLORS.length];
      players.push({ peerId: conn.peer, name: data.name, color: color });
      updatePlayersUI();
      broadcastPlayers();
      break;
    case "adivina-start-request":
      if (!adivina.activo) iniciarAdivinaHost();
      break;
    case "adivina-guess":
      if (adivina.activo && adivina.ganador === null) procesarIntento(conn.peer, data.numero, conn);
      break;
    case "race-result":
      registrarTiempoCarrera(data.name, data.time);
      break;
    case "car-update":
      // El host recibe la posición del invitado y la guarda
      cars[conn.peer] = data.state;
      broadcastCars();
      break;
  }
}

function handleDataAsGuest(data) {
  switch (data.type) {
    case "players":
      players = data.players;
      updatePlayersUI();
      break;
    case "force-game":
      abrirJuego(data.game, true);
      break;
    case "start-race":
      const iframe = document.querySelector("iframe");
      if (iframe) {
        // Pasamos mi ID, mi color y mi índice (para arrancar escalonados)
        iframe.contentWindow.postMessage({ 
          type: 'start-race', 
          myId: myId,
          myColor: players.find(p => p.peerId === myId)?.color || "#fff",
          offset: data.offset
        }, '*');
        iframe.focus();
      }
      break;
    case "cars-sync":
      const iframeSync = document.querySelector("iframe");
      if (iframeSync) iframeSync.contentWindow.postMessage({ type: 'cars-sync', cars: data.cars }, '*');
      break;
    case "race-results":
      const iframeRes = document.querySelector("iframe");
      if (iframeRes) iframeRes.contentWindow.postMessage({ type: 'show-results', results: data.results }, '*');
      break;
    case "adivina-start":
      adivina = { secreto: null, activo: true, ganador: null };
      if (currentGame === "adivina") { renderAdivina(); showScreen("game"); }
      break;
    case "adivina-result":
      agregarLog(`Vos: ${data.numero} → ${data.pista}`, "you");
      break;
    case "adivina-other-result":
      agregarLog(`${data.name}: ${data.numero} → ${data.pista}`, "other");
      break;
    case "adivina-winner":
      adivina.activo = false;
      adivina.ganador = data.name;
      agregarLog(`🏆 ¡${data.name} acertó el número ${data.numero}!`, "win");
      renderAdivinaFinish();
      break;
    case "adivina-closed":
      currentGame = null;
      showScreen("room");
      break;
  }
}

function broadcastPlayers() {
  if (!isHost) return;
  connections.forEach(c => { if (c.open) c.send({ type: "players", players }); });
}

function broadcastCars() {
  if (!isHost) return;
  const msg = { type: "cars-sync", cars };
  connections.forEach(c => { if (c.open) c.send(msg); });
  const iframe = document.querySelector("iframe");
  if (iframe) iframe.contentWindow.postMessage(msg, '*');
}

// ==========================================
// ENTRAR / SALIR SALA
// ==========================================
function entrarSala() {
  document.getElementById("room-code").textContent = roomCode;
  updatePlayersUI();
  currentGame = null;
  raceResults = [];
  cars = {};
  document.querySelectorAll(".game-card").forEach(c => {
    if (!isHost) c.classList.add("disabled");
    else c.classList.remove("disabled");
  });
  showScreen("room");
}

function salirSala() {
  if (myPeer) { myPeer.destroy(); myPeer = null; }
  connections = []; players = []; hostConn = null;
  roomCode = ""; isHost = false; currentGame = null; raceResults = []; cars = {};
  showScreen("lobby");
  document.getElementById("join-code").value = "";
}

function updatePlayersUI() {
  const list = document.getElementById("players-list");
  document.getElementById("player-count").textContent = players.length;
  list.innerHTML = "";
  players.forEach((p, i) => {
    const chip = document.createElement("div");
    let cls = "player-chip";
    if (i === 0) cls += " host";
    if (p.peerId === myId) cls += " me";
    chip.className = cls;
    // Pintamos un puntito con el color del auto del jugador
    chip.innerHTML = `<span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${p.color}; margin-right:8px; border:1px solid #fff;"></span>` + escapeHtml(p.name) + (i === 0 ? '<span class="host-tag">👑</span>' : "");
    list.appendChild(chip);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// ABRIR JUEGOS
// ==========================================
function abrirJuego(juego, force = false) {
  if (!isHost && !force) return; 
  
  currentGame = juego;
  
  if (isHost && juego !== "adivina") {
    connections.forEach(c => { if (c.open) c.send({ type: "force-game", game: juego }); });
  }

  if (juego === "adivina") {
    abrirAdivina();
  } else {
    document.getElementById("game-title").textContent = tituloJuego(juego);
    const container = document.getElementById("game-content");
    container.innerHTML = "";
    
    const iframe = document.createElement("iframe");
    iframe.src = `games/${juego}.html${juego === 'carrera' ? (isHost ? '?host=true' : '?host=false') : ''}`;
    
    iframe.onload = () => {
      try {
        const link = iframe.contentDocument.querySelector("a.volver");
        if (link) link.style.display = "none";
      } catch (e) {}
    };
    container.appendChild(iframe);
    showScreen("game");
  }
}

function tituloJuego(j) {
  return { carrera: "🏎️ Carrera Multijugador", tictactoe: "❌⭕ Tres en Línea", memoria: "🧠 Memoria" }[j] || j;
}

function volverSala() {
  const wasAdivina = currentGame === "adivina" && adivina.activo;
  if (isHost && wasAdivina) {
    connections.forEach(c => { if (c.open) c.send({ type: "adivina-closed" }); });
  }
  document.getElementById("game-content").innerHTML = "";
  currentGame = null;
  adivina = { secreto: null, activo: false, ganador: null };
  raceResults = [];
  cars = {};
  showScreen("room");
}

// ==========================================
// LÓGICA DE CARRERA
// ==========================================
function registrarTiempoCarrera(nombre, tiempo) {
  if (!isHost) return;
  raceResults.push({ name: nombre, time: tiempo });
  raceResults.sort((a, b) => a.time - b.time);
  
  connections.forEach(c => { if (c.open) c.send({ type: "race-results", results: raceResults }); });
  
  const iframe = document.querySelector("iframe");
  if (iframe) iframe.contentWindow.postMessage({ type: 'show-results', results: raceResults }, '*');
}

// ==========================================
// ADIVINA EL NÚMERO
// ==========================================
function abrirAdivina() {
  document.getElementById("game-title").textContent = "🌐 Adivina el Número";
  if (isHost) {
    if (adivina.activo) renderAdivina();
    else {
      document.getElementById("game-content").innerHTML = `
        <div class="adivina-container">
          <h3>🌐 Adivina el Número</h3>
          <p class="info-text">Número del 1 al 100. El primero en acertar gana.</p>
          <button class="btn-primary" onclick="iniciarAdivinaHost()">🎲 Iniciar Partida</button>
          <div class="adivina-log" id="adivina-log"></div>
        </div>`;
    }
  } else {
    if (adivina.activo) renderAdivina();
    else {
      document.getElementById("game-content").innerHTML = `
        <div class="adivina-container">
          <h3>🌐 Adivina el Número</h3>
          <p class="info-text">Esperando que el host inicie la partida...</p>
          <div class="adivina-log" id="adivina-log"></div>
        </div>`;
    }
  }
  showScreen("game");
}

function iniciarAdivinaHost() {
  if (!isHost || adivina.activo) return;
  adivina = { secreto: Math.floor(Math.random() * 100) + 1, activo: true, ganador: null };
  connections.forEach(c => { if (c.open) c.send({ type: "adivina-start" }); });
  currentGame = "adivina";
  renderAdivina();
}

function renderAdivina() {
  document.getElementById("game-content").innerHTML = `
    <div class="adivina-container">
      <h3>🌐 Adivina el Número</h3>
      <p class="info-text">Número del 1 al 100. ¡El primero en acertar gana!</p>
      <div class="guess-row">
        <input id="adivina-input" type="number" min="1" max="100" placeholder="Tu número">
        <button class="btn-primary" onclick="enviarIntento()" style="width:auto;padding:0.9rem 1.5rem">Probar</button>
      </div>
      <div class="adivina-log" id="adivina-log"></div>
    </div>`;
  document.getElementById("adivina-input").addEventListener("keypress", e => { if (e.key === "Enter") enviarIntento(); });
  document.getElementById("adivina-input").focus();
}

function renderAdivinaFinish() {
  const input = document.getElementById("adivina-input");
  if (input) input.disabled = true;
  if (isHost) {
    const container = document.querySelector(".adivina-container");
    if (container && !container.querySelector(".btn-restart")) {
      const btn = document.createElement("button");
      btn.className = "btn-primary btn-restart";
      btn.style.marginTop = "1rem";
      btn.textContent = "🔁 Jugar Otra Vez";
      btn.onclick = () => { adivina = { secreto: null, activo: false, ganador: null }; iniciarAdivinaHost(); };
      container.appendChild(btn);
    }
  }
}

function enviarIntento() {
  const input = document.getElementById("adivina-input");
  if (!input) return;
  const n = parseInt(input.value);
  if (!n || n < 1 || n > 100 || !adivina.activo || adivina.ganador !== null) return;

  if (isHost) procesarIntento(myId, n, null);
  else { hostConn.send({ type: "adivina-guess", numero: n }); agregarLog(`Vos: ${n} → enviando...`, "you"); }
  input.value = "";
  input.focus();
}

function procesarIntento(peerId, numero, conn) {
  if (!isHost || !adivina.activo || adivina.ganador !== null) return;
  let pista = numero === adivina.secreto ? "¡ACERTASTE!" : (numero < adivina.secreto ? "Muy bajo" : "Muy alto");

  if (peerId === myId) {
    agregarLog(`Vos: ${numero} → ${pista}`, "you");
    if (pista === "¡ACERTASTE!") {
      adivina.activo = false; adivina.ganador = myName;
      agregarLog(`🏆 ¡Acertaste! Era ${adivina.secreto}`, "win");
      renderAdivinaFinish();
      connections.forEach(c => { if (c.open) c.send({ type: "adivina-winner", name: myName, numero: adivina.secreto }); });
    }
  } else {
    const j = players.find(p => p.peerId === peerId);
    const nombre = j ? j.name : "Alguien";
    if (conn && conn.open) conn.send({ type: "adivina-result", numero, pista });
    connections.forEach(c => { if (c !== conn && c.open) c.send({ type: "adivina-other-result", name: nombre, numero, pista }); });
    if (pista === "¡ACERTASTE!") {
      adivina.activo = false; adivina.ganador = nombre;
      agregarLog(`🏆 ¡${nombre} acertó el número ${adivina.secreto}!`, "win");
      renderAdivinaFinish();
      connections.forEach(c => { if (c.open) c.send({ type: "adivina-winner", name: nombre, numero: adivina.secreto }); });
    }
  }
}

function agregarLog(msg, clase) {
  const log = document.getElementById("adivina-log");
  if (!log) return;
  const p = document.createElement("p");
  if (clase) p.className = clase;
  p.textContent = msg;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

// ==========================================
// MENSAJES DESDE EL IFRAME (CARRERA)
// ==========================================
window.addEventListener("message", (event) => {
  if (event.data.type === "host-start-race") {
    cars = {}; // Limpiamos posiciones anteriores
    const iframe = document.querySelector("iframe");

    // Arrancar el iframe del Host
    if (iframe) {
      iframe.contentWindow.postMessage({ 
        type: 'start-race', 
        myId: myId, 
        myColor: players.find(p => p.peerId === myId).color, 
        offset: 0 
      }, '*');
    }

    // Arrancar los iframes de los invitados
    connections.forEach((c, i) => { 
      if (c.open) {
        const p = players.find(p => p.peerId === c.peer);
        c.send({ 
          type: "start-race", 
          myId: c.peer, 
          myColor: p ? p.color : "#fff", 
          offset: i + 1 
        }); 
      }
    });
  } 
  else if (event.data.type === "car-update") {
    // El host guarda y reenvía; el invitado manda al host
    if (isHost) {
      cars[myId] = event.data.state;
      broadcastCars();
    } else if (hostConn && hostConn.open) {
      hostConn.send({ type: "car-update", state: event.data.state });
    }
  }
  else if (event.data.type === "race-finished") {
    if (isHost) {
      registrarTiempoCarrera(myName, event.data.time);
    } else {
      hostConn.send({ type: "race-result", name: myName, time: event.data.time });
    }
  }
});

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("nickname-input").focus();
});