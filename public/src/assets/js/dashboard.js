// Notification sound for new requests
const notifyAudio = new Audio("/static/assets/audio/notify.mp3");
notifyAudio.volume = 0.7;

const API = "";
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS = `${wsProtocol}//${window.location.host}/ws/staff`;

let currentFilter = "all";

const socket = new WebSocket(WS);

socket.onopen = () => {
  console.log("WebSocket connected");
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "INVENTORY_UPDATE") {
    renderInventory();
  }

  if (data.type === "NEW_REQUEST") {
    try {
      notifyAudio.currentTime = 0;
      notifyAudio.play();
    } catch (e) {
    }
    renderRequests();
    updateStats();
  } else if (data.type === "STATUS_UPDATE") {
    renderRequests();
    updateStats();
  }
};

socket.onerror = (err) => {
  console.error("WebSocket error:", err);
};

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, m =>
    m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;'
  );
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

async function renderInventory() {
  const res = await fetch(`${API}/api/inventory`);
  if (!res.ok) {
    // Fallback if /api/inventory doesn't exist (it wasn't in main.py)
    return;
  }
  const inventoryItems = await res.json();

  const container = document.getElementById('inventoryList');
  if (!container) return;

  container.innerHTML = inventoryItems.map(item => {
    let stockClass = '';
    const available = item.quantity_available !== undefined ? item.quantity_available : item.available;
    const threshold = item.low_stock_threshold !== undefined ? item.low_stock_threshold : item.threshold;
    const name = item.name;
    const category = item.category;
    const reserved = item.quantity_reserved !== undefined ? item.quantity_reserved : item.reserved;
    const stock = item.quantity_in_stock !== undefined ? item.quantity_in_stock : item.stock;
    const id = item.id;

    if (available <= 0) stockClass = 'out';
    else if (available < threshold) stockClass = 'low';

    return `
      <div class="inv-row">
        <div class="inv-info">
          <h4>${escapeHtml(name)}</h4>
          <p>${category}</p>
        </div>
        <div class="inv-stats">
          <div class="stock-number ${stockClass}">
            ${available} available
          </div>
          <div style="font-size:10px;">
            ${reserved} reserved · total ${stock}
          </div>
          <button class="restock-btn" data-id="${id}">
            + Restock (+5)
          </button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.restock-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;

      await fetch(`${API}/api/inventory/${id}/restock`, {
        method: "POST"
      });
    });
  });
}

async function renderRequests() {
  const res = await fetch(`${API}/api/all_requests`);
  if (!res.ok) return;
  let requests = await res.json();

  const container = document.getElementById('requestsContainer');
  if (!container) return;

  let filtered = requests.filter(r => {
    const status = r.request_status || r.status;
    return currentFilter === "all" ? true : (status ? status.toLowerCase() : "") === currentFilter.toLowerCase();
  });

  filtered.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:20px;"> No requests</div>`;
    return;
  }

  container.innerHTML = filtered.map(req => {
    const status = req.request_status || req.status;
    const isNew = (new Date() - new Date(req.created_at)) < 60000 && status === 'sent';

    return `
      <div class="request-card ${status.toLowerCase()} ${isNew ? 'new-status-animation' : ''}" id="request-${req.id || req.request_id}">
        <div class="card-accent ${status.toLowerCase()}"></div>
        
        <div class="card-header">
          <div class="room-badge">
            Room ${escapeHtml(req.room || req.room_nr)}
            ${isNew ? '<span class="new-tag">NEW</span>' : ''}
          </div>
          <div class="time-ago">${timeAgo(req.created_at)}</div>
        </div>

        <div class="category">Order ID: ${req.id || req.request_id}</div>
        <div class="request-text">“${escapeHtml(req.notes.replace(/SVARA/gi, 'Trivago'))}”</div>

        <div class="item-pills">
          <span class="item-pill">Amount: ${req.amount}</span>
        </div>

        <div class="card-footer">
          <div class="status-badge ${status.toLowerCase()}">${status.replace('_', ' ')}</div>
          
          ${status === 'IN_PROGRESS' || status === 'sent' ? `
            <div class="eta-controls">
              <span class="eta-label">ETA:</span>
              <button class="eta-btn" data-id="${req.id || req.request_id}" data-eta="5">5m</button>
              <button class="eta-btn" data-id="${req.id || req.request_id}" data-eta="10">10m</button>
              <button class="eta-btn" data-id="${req.id || req.request_id}" data-eta="20">20m</button>
              <button class="eta-btn" data-id="${req.id || req.request_id}" data-eta="30">30m</button>
              ${req.eta_minutes ? `<span class="current-eta">(${req.eta_minutes}m)</span>` : ''}
            </div>
          ` : ''}

          <div class="action-group">
            ${status === 'sent' ? `
              <button class="action-btn btn-advance" data-action="IN_PROGRESS" data-id="${req.id || req.request_id}">
                Process →
              </button>
              <button class="action-btn btn-reject" data-action="REJECTED" data-id="${req.id || req.request_id}">
                Reject
              </button>
            ` : ''}

            ${status === 'IN_PROGRESS' ? `
              <button class="action-btn btn-done" data-action="DELIVERED" data-id="${req.id || req.request_id}">
                Complete
              </button>
              <button class="action-btn btn-reject" data-action="REJECTED" data-id="${req.id || req.request_id}">
                Reject
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  bindRequestActions();
}

function bindRequestActions() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const status = btn.dataset.action;

      await fetch(`${API}/api/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
    });
  });

  document.querySelectorAll('.eta-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const eta = btn.dataset.eta;

      await fetch(`${API}/api/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eta })
      });
    });
  });
}

async function addRandomDemoRequest() {
  const newRoom = Math.floor(Math.random() * 300) + 100;

  const newReq = {
    room: String(newRoom),
    text: "Hey Trivago, could I get a blanket and a bottle of water?",
    category: "Room Service",
    items: [
      { inventory_id: 6, name: "Blanket", quantity: 1 },
      { inventory_id: 3, name: "Still Water", quantity: 1 }
    ]
  };

  const res = await fetch(`${API}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newReq)
  });

  if (!res.ok) {
    alert("Not enough stock");
  }
}

async function updateStats() {
  const res = await fetch(`${API}/api/all_requests`);
  if (!res.ok) return;
  const requests = await res.json();

  const active = requests.filter(r => {
      const status = r.request_status || r.status;
      return ['sent', 'IN_PROGRESS'].includes(status);
  }).length;
  const delivered = requests.filter(r => (r.request_status || r.status) === 'DELIVERED').length;

  document.getElementById('statActive').innerText = active;
  document.getElementById('statDelivered').innerText = delivered;
}

document.querySelectorAll('.filter-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-filter');
    console.log("Filtering by:", currentFilter);
    renderRequests();
  });
});

document.getElementById('mockRestockBtn')?.addEventListener('click', async () => {
  await fetch(`${API}/inventory/2/restock`, { method: "POST" });
});

async function init() {
  await renderInventory();
  await renderRequests();
  await updateStats();
}

document.getElementById('monthlyReportBtn')?.addEventListener('click', () => {
  alert("Monthly report coming soon");
});

document.getElementById('stocktakingBtn')?.addEventListener('click', () => {
  alert("Stocktaking session started");
});

init();