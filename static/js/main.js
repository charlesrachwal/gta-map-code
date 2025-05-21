// --- Debounce helper for autocomplete ---
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// --- Autocomplete via Nominatim ---
let currentSuggestions = [];
const addrInput   = document.getElementById('addr-input');
const suggestions = document.getElementById('addr-suggestions');

addrInput.addEventListener('input', debounce(() => {
  const q = addrInput.value.trim();
  if (!q) {
    suggestions.innerHTML = '';
    return;
  }
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q + ', Toronto, Canada')}`;
  fetch(url)
    .then(r => r.json())
    .then(arr => {
      currentSuggestions = arr;
      suggestions.innerHTML = '';
      arr.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.display_name;
        suggestions.append(opt);
      });
    })
    .catch(console.error);
}), 300);

// --- Map & Layers Setup ---
const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19});
const satellite = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',{
  maxZoom:19, subdomains:['mt0','mt1','mt2','mt3']
});
const map = L.map('map',{
  center:[43.6532,-79.3832],
  zoom:11,
  layers:[street]
});
L.control.layers({ Street: street, Satellite: satellite }).addTo(map);
L.control.locate({ flyTo:true }).addTo(map);

// Embedded Geocoder Control
const geocodeControl = L.Control.geocoder({
  placeholder: '🔍 Search address…',
  defaultMarkGeocode: false
}).addTo(map);
geocodeControl.on('markgeocode', e => {
  const { center, name, bbox } = e.geocode;
  map.fitBounds(bbox);
  L.popup().setLatLng(center).setContent(`<b>Preview:</b><br/>${name}`).openOn(map);
});

// Routing control
const router = L.Routing.control({ show: false, addWaypoints: false }).addTo(map);

// Marker cluster & store
const markers = L.markerClusterGroup();
map.addLayer(markers);
let store = {};

// Icon factory
const ICONS = {
  'Not contacted':  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png',
  'Contacted':      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
  'Interested':     'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  'Not interested': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  'Job scheduled':  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-yellow.png',
  'Job completed':  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
};
function makeIcon(s) {
  return new L.Icon({
    iconUrl: ICONS[s],
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    iconSize: [25,41], iconAnchor: [12,41]
  });
}

// --- Fetch & render all points ---
function loadPoints() {
  fetch('/api/addresses')
    .then(r => r.json())
    .then(arr => {
      markers.clearLayers();
      store = {};
      document.getElementById('addr-list').innerHTML = '';

      // sort by follow-up date
      arr.sort((a,b) => {
        if (!a.follow_up_date) return 1;
        if (!b.follow_up_date) return -1;
        return a.follow_up_date.localeCompare(b.follow_up_date);
      });

      arr.forEach(a => {
        store[a.id] = a;
        const m = L.marker([a.lat, a.lng], {icon: makeIcon(a.status)})
                     .bindPopup(popupHtml(a));
        markers.addLayer(m);
        store[a.id].marker = m;

        // sidebar item
        const li = document.createElement('li');
        li.className = 'list-group-item list-group-item-action';
        li.textContent = a.text;
        li.onclick = () => map.flyTo([a.lat, a.lng], 15);
        document.getElementById('addr-list').append(li);
      });
      applyFilters();
    })
    .catch(console.error);
}

// --- Popup template ---
function popupHtml(a) {
  return `
    <label>Status</label>
    <select id="status-${a.id}" class="form-select form-select-sm mb-2">
      ${Object.keys(ICONS).map(s =>
        `<option${a.status===s?' selected':''}>${s}</option>`
      ).join('')}
    </select>

    <label>Follow-up Date</label>
    <input id="followup-${a.id}" type="text"
           class="form-control form-control-sm mb-2"
           placeholder="YYYY-MM-DD"
           value="${a.follow_up_date}"/>

    <label>Notes</label>
    <textarea id="notes-${a.id}"
              class="form-control form-control-sm mb-2"
              rows="2">${a.notes}</textarea>

    <button class="btn btn-sm btn-primary w-100 mb-1" onclick="saveAddress(${a.id})">
      <i class="fa fa-save me-1"></i> Save
    </button>
    <button class="btn btn-sm btn-danger w-100" onclick="deleteAddress(${a.id})">
      <i class="fa fa-trash me-1"></i> Delete
    </button>
  `;
}

// Initialize Flatpickr on popupopen
map.on('popupopen', e => {
  e.popup.getElement()
    .querySelectorAll('input[type="text"]')
    .forEach(inp => flatpickr(inp, { dateFormat:'Y-m-d' }));
});

// --- CRUD Handlers ---
window.saveAddress = function(id) {
  const status         = document.getElementById(`status-${id}`).value;
  const follow_up_date = document.getElementById(`followup-${id}`).value;
  const notes          = document.getElementById(`notes-${id}`).value;
  fetch(`/api/addresses/${id}`, {
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ status, follow_up_date, notes })
  })
  .then(r => r.ok ? loadPoints() : r.json().then(e=>Promise.reject(e.error)))
  .catch(alert);
};

window.deleteAddress = function(id) {
  if (!confirm('Delete this address?')) return;
  fetch(`/api/addresses/${id}`, { method:'DELETE' })
    .then(r => r.ok ? loadPoints() : r.json().then(e=>Promise.reject(e.error)))
    .catch(alert);
};

// --- Search & Add Buttons ---
document.getElementById('search-btn').onclick = () => {
  const q = addrInput.value.trim();
  if (!q) return alert('Enter address to search!');
  geocodeControl.options.geocoder.geocode(q + ', Toronto, Canada', results => {
    if (!results.length) return alert('Not found');
    const { center, name, bbox } = results[0];
    map.fitBounds(bbox);
    L.popup().setLatLng(center).setContent(`<b>${name}</b>`).openOn(map);
  });
};

document.getElementById('add-btn').onclick = () => {
  const text   = addrInput.value.trim();
  if (!text) return alert('Enter an address!');
  const status = document.getElementById('status-select').value;

  // match typed text to one of our suggestions
  const sel = currentSuggestions.find(s => s.display_name === text);
  const payload = { text, status };
  if (sel) {
    payload.lat = parseFloat(sel.lat);
    payload.lng = parseFloat(sel.lon);
  }

  fetch('/api/addresses', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => r.ok ? loadPoints() : r.json().then(e=>Promise.reject(e.error)))
  .catch(alert);
};

// --- Filters & sidebar search ---
document.querySelectorAll('.filter-checkbox').forEach(cb =>
  cb.addEventListener('change', applyFilters)
);
document.getElementById('search-input')
  .addEventListener('input', applyFilters);

function applyFilters() {
  const active = new Set(
    [...document.querySelectorAll('.filter-checkbox:checked')]
      .map(i => i.value)
  );
  const term = document.getElementById('search-input').value.toLowerCase();

  Object.values(store).forEach(a => {
    const okStatus = active.has(a.status);
    const okText   = a.text.toLowerCase().includes(term);
    if (okStatus && okText) markers.addLayer(a.marker);
    else                    markers.removeLayer(a.marker);

    [...document.querySelectorAll('#addr-list li')].forEach(li => {
      if (li.textContent === a.text) {
        li.style.display = (okStatus && okText) ? '' : 'none';
      }
    });
  });
}

// --- Route Pending Jobs ---
document.getElementById('route-pending').onclick = () => {
  const pts = Object.values(store)
    .filter(a => a.status !== 'Job completed')
    .map(a => L.latLng(a.lat, a.lng));
  if (pts.length < 2) return alert('Need ≥2 pending jobs');
  router.setWaypoints(pts).show();
};

// --- Dark mode toggle ---
document.getElementById('toggle-dark').onclick = () => {
  document.body.classList.toggle('dark');
};

// --- Initialize ---
loadPoints();
