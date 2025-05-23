// --- Device Detection ---
function isMobile() {
  return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// --- Global Variables ---
let currentInterface = null;
let map = null;
let markers = null;
let store = {};
let router = null;

// --- Initialize App ---
function initApp() {
  if (isMobile()) {
    document.getElementById('desktop-interface').style.display = 'none';
    document.getElementById('mobile-interface').style.display = 'flex';
    currentInterface = 'mobile';
    initMobileInterface();
  } else {
    document.getElementById('mobile-interface').style.display = 'none';
    document.getElementById('desktop-interface').style.display = 'block';
    currentInterface = 'desktop';
    initDesktopInterface();
  }
}

// --- Shared Functions ---
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const ICONS = {
  'Not contacted':  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png',
  'Contacted':      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
  'Interested':     'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  'Not interested': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  'Job scheduled':  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-yellow.png',
  'Job completed':  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
};

function makeIcon(status) {
  return new L.Icon({
    iconUrl: ICONS[status],
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    iconSize: [25,41], 
    iconAnchor: [12,41]
  });
}

function loadPoints() {
  fetch('/api/addresses')
    .then(r => r.json())
    .then(arr => {
      if (markers) {
        markers.clearLayers();
      }
      store = {};
      
      // Clear appropriate address list
      if (currentInterface === 'desktop') {
        document.getElementById('addr-list').innerHTML = '';
      } else {
        document.getElementById('mobile-addr-list').innerHTML = '';
      }

      // Sort by follow-up date
      arr.sort((a,b) => {
        if (!a.follow_up_date) return 1;
        if (!b.follow_up_date) return -1;
        return a.follow_up_date.localeCompare(b.follow_up_date);
      });

      arr.forEach(a => {
        store[a.id] = a;
        const m = L.marker([a.lat, a.lng], {icon: makeIcon(a.status)})
                     .bindPopup(popupHtml(a));
        if (markers) {
          markers.addLayer(m);
        }
        store[a.id].marker = m;
      });
      
      // Render address list for current interface
      if (currentInterface === 'desktop') {
        renderDesktopAddressList();
      } else {
        renderMobileAddressList();
      }
      
      applyFilters();
    })
    .catch(console.error);
}

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
           value="${a.follow_up_date || ''}"/>

    <label>Notes</label>
    <textarea id="notes-${a.id}"
              class="form-control form-control-sm mb-2"
              rows="2">${a.notes || ''}</textarea>

    <button class="btn btn-sm btn-primary w-100 mb-1" onclick="saveAddress(${a.id})">
      <i class="fa fa-save me-1"></i> Save
    </button>
    <button class="btn btn-sm btn-danger w-100" onclick="deleteAddress(${a.id})">
      <i class="fa fa-trash me-1"></i> Delete
    </button>
  `;
}

// CRUD Handlers
window.saveAddress = function(id) {
  const status = document.getElementById(`status-${id}`).value;
  const follow_up_date = document.getElementById(`followup-${id}`).value;
  const notes = document.getElementById(`notes-${id}`).value;
  
  fetch(`/api/addresses/${id}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ status, follow_up_date, notes })
  })
  .then(r => r.ok ? loadPoints() : r.json().then(e=>Promise.reject(e.error)))
  .catch(alert);
};

window.deleteAddress = function(id) {
  if (!confirm('Delete this address?')) return;
  fetch(`/api/addresses/${id}`, { method: 'DELETE' })
    .then(r => r.ok ? loadPoints() : r.json().then(e=>Promise.reject(e.error)))
    .catch(alert);
};

// --- DESKTOP INTERFACE ---
function initDesktopInterface() {
  // Initialize map
  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19});
  const satellite = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',{
    maxZoom:19, subdomains:['mt0','mt1','mt2','mt3']
  });
  
  map = L.map('map', {
    center: [43.6532, -79.3832],
    zoom: 11,
    layers: [street]
  });
  
  L.control.layers({ Street: street, Satellite: satellite }).addTo(map);
  L.control.locate({ flyTo: true }).addTo(map);

  // Geocoder control
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
  router = L.Routing.control({ show: false, addWaypoints: false }).addTo(map);

  // Marker cluster
  markers = L.markerClusterGroup();
  map.addLayer(markers);

  // Initialize desktop-specific features
  initDesktopAutocomplete();
  initDesktopClickToAdd();
  initDesktopEventHandlers();
  
  // Initialize Flatpickr on popup open
  map.on('popupopen', e => {
    e.popup.getElement()
      .querySelectorAll('input[type="text"]')
      .forEach(inp => flatpickr(inp, { dateFormat:'Y-m-d' }));
  });
}

function initDesktopAutocomplete() {
  let currentSuggestions = [];
  const addrInput = document.getElementById('addr-input');
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
  }, 300));

  // Store suggestions globally for add button
  window.currentSuggestions = currentSuggestions;
}

function initDesktopClickToAdd() {
  let clickToAddMode = false;
  let tempMarker = null;

  // Add toggle button for click-to-add mode
  const clickToAddControl = L.control({ position: 'topright' });
  clickToAddControl.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
    div.innerHTML = '<button id="click-add-toggle" class="btn btn-outline-primary btn-sm" title="Toggle click-to-add mode"><i class="fa fa-crosshairs"></i> Click to Add</button>';
    div.style.backgroundColor = 'white';
    div.style.padding = '5px';
    return div;
  };
  clickToAddControl.addTo(map);

  // Toggle click-to-add mode
  document.addEventListener('click', (e) => {
    if (e.target.id === 'click-add-toggle' || e.target.closest('#click-add-toggle')) {
      clickToAddMode = !clickToAddMode;
      const button = document.getElementById('click-add-toggle');
      if (clickToAddMode) {
        button.innerHTML = '<i class="fa fa-times"></i> Cancel';
        button.className = 'btn btn-danger btn-sm';
        map.getContainer().style.cursor = 'crosshair';
      } else {
        button.innerHTML = '<i class="fa fa-crosshairs"></i> Click to Add';
        button.className = 'btn btn-outline-primary btn-sm';
        map.getContainer().style.cursor = '';
        if (tempMarker) {
          map.removeLayer(tempMarker);
          tempMarker = null;
        }
      }
    }
  });

  // Handle map clicks for adding locations
  map.on('click', function(e) {
    if (!clickToAddMode) return;
    
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    
    if (tempMarker) {
      map.removeLayer(tempMarker);
    }
    
    const status = document.getElementById('status-select').value;
    const address = `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    
    fetch('/api/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: address, lat: lat, lng: lng, status: status })
    })
    .then(r => r.ok ? r.json() : r.json().then(e=>Promise.reject(e.error)))
    .then(newAddress => {
      loadPoints();
      setTimeout(() => {
        const newMarker = Object.values(store).find(a => a.id === newAddress.id);
        if (newMarker && newMarker.marker) {
          map.flyTo([lat, lng], 15);
          newMarker.marker.openPopup();
        }
      }, 500);
      
      clickToAddMode = false;
      const button = document.getElementById('click-add-toggle');
      button.innerHTML = '<i class="fa fa-crosshairs"></i> Click to Add';
      button.className = 'btn btn-outline-primary btn-sm';
      map.getContainer().style.cursor = '';
    })
    .catch(err => alert('Error adding location: ' + err));
  });
}

function initDesktopEventHandlers() {
  // Search button
  document.getElementById('search-btn').onclick = () => {
    const q = document.getElementById('addr-input').value.trim();
    if (!q) return alert('Enter address to search!');
    
    const geocodeControl = L.Control.geocoder();
    geocodeControl.options.geocoder.geocode(q + ', Toronto, Canada', results => {
      if (!results.length) return alert('Not found');
      const { center, name, bbox } = results[0];
      map.fitBounds(bbox);
      L.popup().setLatLng(center).setContent(`<b>${name}</b>`).openOn(map);
    });
  };

  // Add button
  document.getElementById('add-btn').onclick = () => {
    const text = document.getElementById('addr-input').value.trim();
    if (!text) return alert('Enter an address!');
    const status = document.getElementById('status-select').value;

    const sel = window.currentSuggestions.find(s => s.display_name === text);
    const payload = { text, status };
    if (sel) {
      payload.lat = parseFloat(sel.lat);
      payload.lng = parseFloat(sel.lon);
    }

    fetch('/api/addresses', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    })
    .then(r => r.ok ? loadPoints() : r.json().then(e=>Promise.reject(e.error)))
    .catch(alert);
  };

  // Filters
  document.querySelectorAll('.filter-checkbox').forEach(cb =>
    cb.addEventListener('change', applyFilters)
  );
  
  document.getElementById('search-input').addEventListener('input', applyFilters);

  // Route pending jobs
  document.getElementById('route-pending').onclick = () => {
    const pts = Object.values(store)
      .filter(a => a.status !== 'Job completed')
      .map(a => L.latLng(a.lat, a.lng));
    if (pts.length < 2) return alert('Need ≥2 pending jobs');
    router.setWaypoints(pts).show();
  };

  // Dark mode toggle
  document.getElementById('toggle-dark').onclick = () => {
    document.body.classList.toggle('dark');
  };
}

function renderDesktopAddressList() {
  const listContainer = document.getElementById('addr-list');
  listContainer.innerHTML = '';
  
  Object.values(store).forEach(a => {
    const li = document.createElement('li');
    li.className = 'list-group-item list-group-item-action';
    li.textContent = a.text;
    li.onclick = () => map.flyTo([a.lat, a.lng], 15);
    listContainer.append(li);
  });
}

function applyFilters() {
  if (currentInterface === 'desktop') {
    const active = new Set(
      [...document.querySelectorAll('.filter-checkbox:checked')]
        .map(i => i.value)
    );
    const term = document.getElementById('search-input').value.toLowerCase();

    Object.values(store).forEach(a => {
      const okStatus = active.has(a.status);
      const okText = a.text.toLowerCase().includes(term);
      if (okStatus && okText) markers.addLayer(a.marker);
      else markers.removeLayer(a.marker);

      [...document.querySelectorAll('#addr-list li')].forEach(li => {
        if (li.textContent === a.text) {
          li.style.display = (okStatus && okText) ? '' : 'none';
        }
      });
    });
  } else {
    applyMobileFilters();
  }
}

// --- MOBILE INTERFACE - ALWAYS-ON ADD MODE ---
let mobileCurrentFilter = 'all';
let pendingLocation = null;

function initMobileInterface() {
  // Initialize mobile map
  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19});
  const satellite = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y}{y}&z={z}',{
    maxZoom:19, subdomains:['mt0','mt1','mt2','mt3']
  });
  
  map = L.map('mobile-map', {
    center: [43.6532, -79.3832],
    zoom: 11,
    layers: [street]
  });
  
  // Add basic controls
  L.control.locate({ flyTo: true }).addTo(map);
  
  // Store layer references for mobile controls
  window.mobileStreetLayer = street;
  window.mobileSatelliteLayer = satellite;
  window.mobileCurrentLayer = 'street';

  // Routing control
  router = L.Routing.control({ show: false, addWaypoints: false }).addTo(map);

  // Marker cluster
  markers = L.markerClusterGroup();
  map.addLayer(markers);

  // Initialize mobile-specific features
  initMobileEventHandlers();
  initMobileMapClickHandler();
  
  // Initialize Flatpickr on popup open
  map.on('popupopen', e => {
    e.popup.getElement()
      .querySelectorAll('input[type="text"]')
      .forEach(inp => flatpickr(inp, { dateFormat:'Y-m-d' }));
  });

  // ALWAYS ENABLE ADD MODE - Set crosshair cursor permanently
  map.getContainer().style.cursor = 'crosshair';
  console.log('Add mode is always active on mobile');
}

function initMobileEventHandlers() {
  // Bottom navigation - ONLY 3 TABS NOW (Map, List, More)
  document.getElementById('mobile-tab-map').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMobileTab('map');
    closeMobileDrawers();
  });
  
  // REMOVED mobile-tab-add handlers since there's no add tab anymore
  
  document.getElementById('mobile-tab-list').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMobileTab('list');
    openMobileDrawer('list');
  });
  
  document.getElementById('mobile-tab-more').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMobileTab('more');
    openMobileDrawer('more');
  });

  // Drawer close buttons
  document.getElementById('mobile-close-drawer').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMobileDrawers();
    setMobileTab('map');
  });
  
  document.getElementById('mobile-close-more-drawer').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMobileDrawers();
    setMobileTab('map');
  });

  // REMOVED add mode controls - no longer needed

  // Status selector - FIXED FOR iOS SAFARI
  document.getElementById('mobile-cancel-status').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Cancel button touched');
    cancelStatusSelection();
  });
  
  document.getElementById('mobile-confirm-status').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Confirm button touched');
    confirmStatusSelection();
  });

  // Status pills - FIXED FOR iOS SAFARI
  document.addEventListener('touchend', (e) => {
    if (e.target.classList.contains('mobile-status-pill')) {
      e.preventDefault();
      e.stopPropagation();
      console.log('Status pill touched:', e.target.dataset.status);
      
      document.querySelectorAll('.mobile-status-pill').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
    }
  });

  // Mobile search
  document.getElementById('mobile-search-input').addEventListener('input', debounce(() => {
    renderMobileAddressList();
  }, 300));

  // Filter pills
  document.addEventListener('touchend', (e) => {
    if (e.target.classList.contains('mobile-filter-pill')) {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.mobile-filter-pill').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      mobileCurrentFilter = e.target.dataset.status;
      renderMobileAddressList();
    }
  });

  // More options
  document.getElementById('mobile-route-pending').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pts = Object.values(store)
      .filter(a => a.status !== 'Job completed')
      .map(a => L.latLng(a.lat, a.lng));
    if (pts.length < 2) {
      alert('Need ≥2 pending jobs');
      return;
    }
    router.setWaypoints(pts).show();
    closeMobileDrawers();
    setMobileTab('map');
  });

  document.getElementById('mobile-toggle-satellite').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.mobileCurrentLayer === 'street') {
      map.removeLayer(window.mobileStreetLayer);
      map.addLayer(window.mobileSatelliteLayer);
      window.mobileCurrentLayer = 'satellite';
    } else {
      map.removeLayer(window.mobileSatelliteLayer);
      map.addLayer(window.mobileStreetLayer);
      window.mobileCurrentLayer = 'street';
    }
    closeMobileDrawers();
    setMobileTab('map');
  });

  document.getElementById('mobile-locate-me').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    map.locate({ setView: true, maxZoom: 16 });
    closeMobileDrawers();
    setMobileTab('map');
  });

  // Dark mode toggle
  document.getElementById('mobile-toggle-dark').addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.toggle('dark');
  });

  // FALLBACK: Click events for non-touch devices
  document.getElementById('mobile-tab-map').addEventListener('click', (e) => {
    e.preventDefault();
    setMobileTab('map');
    closeMobileDrawers();
  });
  
  // REMOVED mobile-tab-add click handler
  
  document.getElementById('mobile-tab-list').addEventListener('click', (e) => {
    e.preventDefault();
    setMobileTab('list');
    openMobileDrawer('list');
  });
  
  document.getElementById('mobile-tab-more').addEventListener('click', (e) => {
    e.preventDefault();
    setMobileTab('more');
    openMobileDrawer('more');
  });

  // Status selector fallback click events
  document.getElementById('mobile-cancel-status').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancelStatusSelection();
  });
  
  document.getElementById('mobile-confirm-status').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    confirmStatusSelection();
  });
}

function initMobileMapClickHandler() {
  // ALWAYS ACTIVE - No need to check mobileAddMode anymore
  map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    
    // Store pending location and show status selector
    pendingLocation = { lat, lng };
    document.getElementById('mobile-status-selector').style.display = 'flex';
    
    // Reset status selection to first option
    document.querySelectorAll('.mobile-status-pill').forEach(p => p.classList.remove('active'));
    document.querySelector('.mobile-status-pill').classList.add('active');
  });
}

function setMobileTab(tab) {
  document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
  const tabElement = document.getElementById(`mobile-tab-${tab}`);
  if (tabElement) {
    tabElement.classList.add('active');
  }
}

// REMOVED toggleMobileAddMode and cancelMobileAddMode functions

function cancelStatusSelection() {
  document.getElementById('mobile-status-selector').style.display = 'none';
  pendingLocation = null;
}

function confirmStatusSelection() {
  if (!pendingLocation) return;
  
  const selectedStatusElement = document.querySelector('.mobile-status-pill.active');
  if (!selectedStatusElement) {
    alert('Please select a status');
    return;
  }
  
  const selectedStatus = selectedStatusElement.dataset.status;
  const address = `Location (${pendingLocation.lat.toFixed(4)}, ${pendingLocation.lng.toFixed(4)})`;
  
  console.log('Adding location with status:', selectedStatus);
  
  fetch('/api/addresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: address,
      lat: pendingLocation.lat,
      lng: pendingLocation.lng,
      status: selectedStatus
    })
  })
  .then(r => r.ok ? r.json() : r.json().then(e=>Promise.reject(e.error)))
  .then(newAddress => {
    console.log('Location added successfully:', newAddress);
    loadPoints();
    setTimeout(() => {
      const newMarker = Object.values(store).find(a => a.id === newAddress.id);
      if (newMarker && newMarker.marker) {
        map.flyTo([pendingLocation.lat, pendingLocation.lng], 15);
        newMarker.marker.openPopup();
      }
    }, 500);
    
    // JUST HIDE STATUS SELECTOR - DON'T CHANGE ADD MODE
    document.getElementById('mobile-status-selector').style.display = 'none';
    pendingLocation = null;
    
    // KEEP CROSSHAIR CURSOR ACTIVE FOR NEXT TAP
    map.getContainer().style.cursor = 'crosshair';
  })
  .catch(err => {
    console.error('Error adding location:', err);
    alert('Error adding location: ' + err);
    cancelStatusSelection();
  });
}

function openMobileDrawer(type) {
  closeMobileDrawers();
  
  if (type === 'list') {
    document.getElementById('mobile-list-drawer').classList.add('show');
    renderMobileAddressList();
  } else if (type === 'more') {
    document.getElementById('mobile-more-drawer').classList.add('show');
  }
}

function closeMobileDrawers() {
  document.querySelectorAll('.mobile-drawer').forEach(drawer => {
    drawer.classList.remove('show');
  });
}

function renderMobileAddressList() {
  const listContainer = document.getElementById('mobile-addr-list');
  const searchTerm = document.getElementById('mobile-search-input').value.toLowerCase();
  
  listContainer.innerHTML = '';
  
  const filteredAddresses = Object.values(store).filter(a => {
    const matchesSearch = a.text.toLowerCase().includes(searchTerm);
    const matchesFilter = mobileCurrentFilter === 'all' || a.status === mobileCurrentFilter;
    return matchesSearch && matchesFilter;
  });
  
  filteredAddresses.forEach(a => {
    const item = document.createElement('div');
    item.className = 'mobile-address-item';
    item.innerHTML = `
      <div class="mobile-address-info">
        <div class="mobile-address-text">${a.text}</div>
        <span class="mobile-address-status status-${a.status.toLowerCase().replace(' ', '-')}">${a.status}</span>
      </div>
      <div class="mobile-address-actions">
        <button class="mobile-action-btn" onclick="navigateToAddress(${a.id})">
          <i class="fa fa-location-arrow"></i>
        </button>
        <button class="mobile-action-btn" onclick="editMobileAddress(${a.id})">
          <i class="fa fa-edit"></i>
        </button>
      </div>
    `;
    listContainer.appendChild(item);
  });
}

function applyMobileFilters() {
  // Mobile filtering is handled in renderMobileAddressList
  renderMobileAddressList();
}

// Mobile-specific functions
window.navigateToAddress = function(id) {
  const address = store[id];
  if (address) {
    map.flyTo([address.lat, address.lng], 16);
    closeMobileDrawers();
    setMobileTab('map');
    
    // Optional: Open popup after a short delay
    setTimeout(() => {
      if (address.marker) {
        address.marker.openPopup();
      }
    }, 500);
  }
};

window.editMobileAddress = function(id) {
  const address = store[id];
  if (address) {
    map.flyTo([address.lat, address.lng], 16);
    closeMobileDrawers();
    setMobileTab('map');
    
    setTimeout(() => {
      if (address.marker) {
        address.marker.openPopup();
      }
    }, 500);
  }
};

// --- Window Resize Handler ---
function handleResize() {
  const wasMobile = currentInterface === 'mobile';
  const isMobileNow = isMobile();
  
  if (wasMobile !== isMobileNow) {
    // Interface changed, reinitialize
    location.reload(); // Simple solution - reload page
  }
}

// --- Prevent Mobile Zoom ---
function preventMobileZoom() {
  // Prevent pinch zoom
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
  document.addEventListener('gestureend', e => e.preventDefault());
  
  // Prevent double-tap zoom on interactive elements
  document.addEventListener('touchend', e => {
    const target = e.target;
    if (target.matches('button, .btn, .mobile-tab, .mobile-address-item, .mobile-option-item')) {
      // Small delay to allow the touch event to process first
      setTimeout(() => {
        e.preventDefault();
      }, 1);
    }
  });
  
  // Prevent text selection on interactive elements
  document.addEventListener('selectstart', e => {
    const target = e.target;
    if (target.matches('.mobile-tab, .mobile-address-item, .mobile-option-item, .mobile-filter-pill')) {
      e.preventDefault();
    }
  });
  
  // Additional iOS Safari fixes
  document.addEventListener('touchstart', e => {
    // Prevent iOS from interfering with our touch events
    if (e.target.matches('.mobile-status-pill, .mobile-filter-pill, .mobile-tab, button')) {
      e.target.style.webkitTouchCallout = 'none';
      e.target.style.webkitUserSelect = 'none';
    }
  });
  
  // Fix iOS Safari button highlighting issues
  document.addEventListener('touchstart', () => {}, {passive: true});
}

// --- Initialize Everything ---
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing app...'); // Debug log
  initApp();
  loadPoints();
  
  if (isMobile()) {
    console.log('Mobile detected, applying mobile optimizations...'); // Debug log
    preventMobileZoom();
  }
});

// Handle orientation changes and resizing
window.addEventListener('resize', debounce(handleResize, 250));
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    if (map) {
      map.invalidateSize();
    }
    // Force a small delay to ensure proper rendering after orientation change
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
      }
    }, 100);
  }, 500);
});