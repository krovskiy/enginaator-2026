import { showToast } from './toasts.js';
const host = 1488;
const recordButton = document.getElementById("record_button");
const recordStatus = document.getElementById("record_status");
const mainCnt = document.getElementById("mainContainer");

let mediaRecorder;
let chunks = [];
let isRecording = false;


const params = new URLSearchParams(window.location.search);
const room = params.get("room") || "101";

document.getElementById("room_number").textContent =
  `Welcome back, Room nr. ${room}`;


const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${wsProtocol}//${window.location.host}/ws/guest/${room}`);

socket.onopen = () => {
  console.log("WS connected:", room);
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "STATUS_UPDATE") {
    updateRequestUI(data);
  } else if (data.type === "REQUEST_CONFIRMED") {
    renderRequest(data.request);
  }
};

socket.onclose = () => console.log("WS disconnected");
socket.onerror = (err) => console.error("WS error", err);


function updateStatus(text) {
  recordStatus.textContent = text;

  recordStatus.classList.remove("idle", "recording", "processing");

  if (text === "Idle") {
    recordStatus.classList.add("idle");
  } else if (text === "Recording...") {
    recordStatus.classList.add("recording");
  } else {
    recordStatus.classList.add("processing");
  }
}

function updateRequestUI(payload) {
  const requestId = payload.id || payload.request_id;
  const existing = document.getElementById(`request-${requestId}`);
  if (!existing) return;

  const statusEl = existing.querySelector('.status-badge');
  const etaEl = existing.querySelector('.eta-value');

  const status = (payload.request_status || payload.status || "sent").toLowerCase();
  if (statusEl) {
    let displayStatus = status.toUpperCase();
    if (status === 'sent') displayStatus = 'RECEIVED';
    if (status === 'in_progress') displayStatus = 'PROCESSING';
    
    statusEl.textContent = displayStatus;
    statusEl.className = `status-badge status-${status}`;
  }
  if (etaEl && (payload.eta || payload.eta_minutes)) {
    etaEl.textContent = `${payload.eta || payload.eta_minutes} min`;
  }
}

function renderRequest(payload) {
  if (!payload) return;

  const requestId = payload.id || payload.request_id || payload.item_id || 'new';
  const existing = document.getElementById(`request-${requestId}`);
  if (existing) existing.remove();

  const wrapper = document.createElement("div");
  wrapper.id = `request-${requestId}`;
  wrapper.className = "request-history-card-wrapper";

  const requestText = payload.text_as_notes || payload.notes || payload.item_name || payload.name || "Request";
  const status = (payload.request_status || payload.status || "sent").toLowerCase();
  const eta = payload.eta || payload.eta_minutes || "-";
  let displayStatus = status.toUpperCase();
  if (status === 'sent') displayStatus = 'RECEIVED';
  if (status === 'in_progress') displayStatus = 'PROCESSING';
  
  const displayEta = eta !== "-" ? `${eta} min` : "-";

  wrapper.innerHTML = `
    <div class="request-history-card">
      <div class="card-header">
        <span class="order-id">ORDER #${requestId}</span>
        <span class="status-badge status-${status}">${displayStatus}</span>
      </div>
      
      <div class="card-body">
        <div class="request-content">
          <label>REQUEST</label>
          <p class="request-text">"${requestText}"</p>
        </div>
        
        <div class="eta-info">
          <label>ETA</label>
          <p class="eta-value">${displayEta}</p>
        </div>
      </div>
    </div>
  `;

  mainCnt.appendChild(wrapper);
}

async function fetchHistory() {
  try {
    const res = await fetch(`/api/requests/room/${room}`);
    if (!res.ok) return;
    const history = await res.json();
    history.forEach(item => renderRequest(item));
  } catch (err) {
    console.error("Failed to fetch history:", err);
  }
}

async function ensureRecorder() {
  if (mediaRecorder) return;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    chunks = [];
    await sendAudio(blob);
  };
}

async function sendAudio(blob) {
  updateStatus("Transcribing...");

  try {
    const response = await fetch(`/api/new_request?room_nr=${room}`, {
      method: "POST",
      body: blob,
    });

    if (!response.ok) throw new Error("Server error");

    let result = await response.json();

    if (result.error) {
      showToast({ message: `Error: ${result.error}`, type: 'failure' });
      updateStatus("Idle");
      return;
    }

    if (Array.isArray(result) && result.length === 2 && typeof result[1] === 'number') {
      result = result[0];
    }

    const hasAddedItems = result.items && result.items.length > 0;
    const hasUnavailableItems = result.unavailable_items && result.unavailable_items.length > 0;

    if (hasAddedItems) {
      result.items.forEach(item => renderRequest(item));
      showToast({ message: 'Request processed successfully', type: 'success' });
    }

    if (hasUnavailableItems) {
      result.unavailable_items.forEach(un => {
        const itemName = un.item?.item_name || un.item?.name || un.item || "Unknown item";
        showToast({ message: `Unavailable: ${itemName} - ${un.reason}`, type: 'failure' });
      });
    }

    if (!hasAddedItems && !hasUnavailableItems) {
      showToast({ message: 'No items recognized in your request', type: 'failure' });
    }

    updateStatus("Idle");

  } catch (err) {
    console.error(err);
    showToast({ message: `Transcription failed: ${err.message || 'Unknown error'}`, type: 'failure' });
    updateStatus("Idle");
  }
}

const voiceBox = document.getElementById("voice_box");

recordButton.addEventListener("click", async () => {
  try {
    await ensureRecorder();
  } catch (error) {
    console.error(error);
    return;
  }

  if (!isRecording) {
    isRecording = true;
    updateStatus("Recording...");
    mediaRecorder.start();
    voiceBox.classList.add("recording");
    return;
  }

  isRecording = false;
  updateStatus("Stopping...");
  mediaRecorder.stop();
  voiceBox.classList.remove("recording");
});

updateStatus("Idle");
fetchHistory();