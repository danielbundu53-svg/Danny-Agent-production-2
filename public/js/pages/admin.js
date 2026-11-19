/* =========================================================
   DANNY AGENT - FULL ADMIN OPERATIONS DASHBOARD
   Handles: Enquiries, Analytics, Property CRUD, Image Gallery,
   Customers CRM, Team/Agent RBAC, Site Settings & System Logs
   ========================================================= */

const SESSION_KEY = 'adminKeyForThisTab';
const SESSION_TOKEN_KEY = 'adminTokenForThisTab';
const SESSION_USER_KEY = 'adminUserForThisTab';
const STATUSES = ['new', 'contacted', 'qualified', 'closed'];
const PROPERTY_STATUSES = ['available', 'under_offer', 'sold', 'rented', 'archived'];
const SERVICE_LABELS = {
  buy: 'Buying', rent: 'Renting', sell: 'Selling',
  investment: 'Investment', management: 'Management', other: 'Other'
};

/* DOM Elements */
const keyInput = document.getElementById('adminKey');
const statusEl = document.getElementById('status');
const rows = document.getElementById('inquiryRows');
const searchBox = document.getElementById('searchBox');
const statusFilter = document.getElementById('statusFilter');
const serviceFilter = document.getElementById('serviceFilter');
const loginForm = document.getElementById('loginForm');
const sessionBar = document.getElementById('sessionBar');
const adminPortal = document.getElementById('adminPortal');

/* State */
let currentKey = '';
let currentToken = '';
let currentUser = { role: 'admin', name: 'Administrator' };
let allInquiries = [];
let allProperties = [];
let allCustomers = [];
let allUsers = [];
let allAgents = [];
let selectedPropertyForMedia = null;

try {
  currentKey = sessionStorage.getItem(SESSION_KEY) || '';
  currentToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || '';
  const savedUser = sessionStorage.getItem(SESSION_USER_KEY);
  if (savedUser) currentUser = JSON.parse(savedUser);
} catch (e) { /* storage blocked */ }

/* Safe text helper from site.js or fallback */
const escapeText = typeof esc === 'function' ? esc : (value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

function say(text, bad = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = 'mb-4 text-base font-medium px-4 py-3 rounded-xl transition ' +
    (bad ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200');
  if (!bad) {
    setTimeout(() => {
      if (statusEl.textContent === text) {
        statusEl.textContent = '';
        statusEl.className = 'mb-4 text-base';
      }
    }, 5000);
  }
}

/* Timeout-protected fetch helper */
async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const headers = { ...(options.headers || {}) };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
    headers['x-session-token'] = currentToken;
  }
  if (currentKey) {
    headers['x-admin-key'] = currentKey;
  }

  try {
    return await fetch(url, { ...options, headers, signal: controller.signal });
  } catch (error) {
    const failure = new Error(error && error.name === 'AbortError' ? 'The connection is too slow.' : 'Could not reach the server.');
    failure.network = true;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

function showSignedIn(isIn) {
  loginForm.classList.toggle('hidden', isIn);
  sessionBar.classList.toggle('hidden', !isIn);
  adminPortal.classList.toggle('hidden', !isIn);
  const userBadge = document.getElementById('userBadge');
  if (userBadge) {
    userBadge.classList.toggle('hidden', !isIn);
    document.getElementById('userNameDisplay').textContent = currentUser.name || currentUser.username || 'Admin';
    document.getElementById('userRoleBadge').textContent = currentUser.role || 'admin';
  }

  // Toggle role-restricted tabs
  const isRealAdmin = currentUser.role === 'admin';
  document.querySelectorAll('[data-role-req="admin"]').forEach(el => {
    el.classList.toggle('hidden', !isRealAdmin);
  });

  if (isIn) {
    checkMustChangePassword();
  }

  if (window.drawIcons) window.drawIcons();
}

function checkMustChangePassword() {
  const modal = document.getElementById('firstLoginModal');
  const tabsNav = document.getElementById('adminTabs');
  const contentPanels = document.querySelectorAll('.tab-panel');
  if (currentUser && currentUser.mustChangePassword) {
    modal?.classList.remove('hidden');
    tabsNav?.classList.add('opacity-30', 'pointer-events-none');
    contentPanels.forEach(p => p.classList.add('opacity-30', 'pointer-events-none'));
  } else {
    modal?.classList.add('hidden');
    tabsNav?.classList.remove('opacity-30', 'pointer-events-none');
    contentPanels.forEach(p => p.classList.remove('opacity-30', 'pointer-events-none'));
  }
}

function signOut(clearMessage = true) {
  currentKey = '';
  currentToken = '';
  currentUser = { role: 'admin', name: 'Administrator' };
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
  } catch (e) {}

  allInquiries = [];
  allProperties = [];
  keyInput.value = '';
  showSignedIn(false);
  rows.innerHTML = '<tr><td colspan="7" class="p-8 text-left text-gray-500">Enter your admin key and press Load.</td></tr>';
  if (clearMessage) say('Signed out.');
}

function when(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  return isNaN(date) ? String(value) : date.toLocaleString();
}

function contactLinks(item) {
  const digits = String(item.phone || '').replace(/\D/g, '');
  const phone = digits ? `<a class="text-navy font-semibold hover:underline inline-flex items-center gap-1" href="tel:+${esc(digits)}">${esc(item.phone)}</a>` : esc(item.phone);
  const wa = digits ? ` <a class="inline-block mt-1 bg-green-600 text-white text-xs px-2 py-0.5 rounded font-bold hover:bg-green-700 transition" target="_blank" rel="noopener" href="https://wa.me/${esc(digits)}?text=${encodeURIComponent('Hello ' + (item.name || '') + ', Danny Agent received your property inquiry.')}">WhatsApp</a>` : '';
  const mail = item.email ? `<br><a class="text-blue-700 hover:underline text-xs break-all" href="mailto:${esc(encodeURI(item.email))}">${esc(item.email)}</a>` : '';
  return `<strong>${esc(item.name)}</strong><br>${phone}${wa}${mail}`;
}

/* =========================================================
   1. INQUIRIES & LEADS MANAGEMENT
   ========================================================= */

function renderInquiries() {
  const term = (searchBox ? searchBox.value : '').trim().toLowerCase();
  const wantedStatus = statusFilter ? statusFilter.value : '';
  const wantedService = serviceFilter ? serviceFilter.value : '';

  const list = allInquiries.filter(item =>
    (!wantedStatus || item.status === wantedStatus) &&
    (!wantedService || item.service === wantedService) &&
    (!term || [item.name, item.phone, item.email, item.property_title, item.property_location, item.location, item.message, item.service, item.notes]
      .join(' ').toLowerCase().includes(term))
  );

  rows.innerHTML = list.map(item => `
    <tr class="border-t align-top ${item.status === 'new' ? 'bg-amber-50/60' : 'hover:bg-gray-50/50'}">
      <td class="p-4 whitespace-nowrap">
        <span class="font-bold text-slate-800 text-sm">${esc(when(item.created_at))}</span><br>
        <span class="text-xs font-mono text-gray-500 font-semibold">ENQ-${esc(item.id)}</span>
      </td>
      <td class="p-4">${contactLinks(item)}</td>
      <td class="p-4">
        <strong class="text-navy">${esc(item.property_title || 'General enquiry')}</strong><br>
        <span class="text-gray-500 text-sm">${esc(item.property_location || item.location || '')}</span>
        ${item.budget ? `<br><span class="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">Budget: ${esc(item.budget)}</span>` : ''}
      </td>
      <td class="p-4 whitespace-nowrap">
        <span class="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-slate-100 text-slate-800">
          ${esc(SERVICE_LABELS[item.service] || item.service)}
        </span>
      </td>
      <td class="p-4 max-w-sm">
        <p class="whitespace-pre-wrap text-sm text-gray-800">${esc(item.message)}</p>
        ${item.notes ? `<div class="mt-2 text-xs bg-yellow-50 text-amber-900 p-2 rounded border border-amber-200"><strong>Note:</strong> ${esc(item.notes)}</div>` : ''}
        <button type="button" data-note-id="${item.id}" class="mt-2 text-xs text-navy font-semibold hover:underline inline-flex items-center gap-1">
          <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> ${item.notes ? 'Edit note' : '+ Add note'}
        </button>
      </td>
      <td class="p-4 whitespace-nowrap">
        <select data-assign-id="${item.id}" class="agent-assign border border-gray-300 rounded px-2.5 py-1.5 text-base bg-white">
          <option value="">Unassigned</option>
          ${allAgents.map(ag => `<option value="${ag.id}" ${item.assigned_agent_id === ag.id ? 'selected' : ''}>${esc(ag.name)}</option>`).join('')}
        </select>
      </td>
      <td class="p-4 whitespace-nowrap">
        <select data-id="${esc(item.id)}" data-previous="${esc(item.status)}" aria-label="Status for enquiry ${esc(item.id)}" class="status border rounded-lg px-3 py-1.5 font-semibold text-base ${
          item.status === 'new' ? 'border-amber-400 bg-amber-50 text-amber-900' :
          item.status === 'contacted' ? 'border-blue-400 bg-blue-50 text-blue-900' :
          item.status === 'qualified' ? 'border-emerald-400 bg-emerald-50 text-emerald-900' :
          'border-gray-300 bg-gray-50 text-gray-700'
        }">
          ${STATUSES.map(s => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('') || `<tr><td colspan="7" class="p-8 text-center text-gray-500">${allInquiries.length ? 'No enquiries match your search.' : 'No enquiries yet.'}</td></tr>`;

  const fresh = allInquiries.filter(item => item.status === 'new').length;
  document.getElementById('inquiryCountBadge').textContent = fresh;
  say(`${list.length} of ${allInquiries.length} enquiries shown. ${fresh} new.`);
  if (window.drawIcons) window.drawIcons();
}

async function updateStatus(select) {
  const id = Number(select.dataset.id);
  const previous = select.dataset.previous;
  const next = select.value;
  select.disabled = true;
  try {
    const res = await fetchWithTimeout(`/api/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not save the status.');
    const item = allInquiries.find(entry => entry.id === id);
    if (item) item.status = next;
    select.dataset.previous = next;
    renderInquiries();
    say(`Enquiry ENQ-${id} status updated to ${next}.`);
  } catch (error) {
    select.value = previous;
    say('Status NOT saved: ' + (error.network ? error.message.toLowerCase() : error.message), true);
  } finally {
    select.disabled = false;
  }
}

async function updateInquiryAssignment(select) {
  const id = Number(select.dataset.assignId);
  const agentId = select.value ? Number(select.value) : null;
  select.disabled = true;
  try {
    const res = await fetchWithTimeout(`/api/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_agent_id: agentId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not assign agent.');
    const item = allInquiries.find(entry => entry.id === id);
    if (item) item.assigned_agent_id = agentId;
    say(`Enquiry ENQ-${id} agent updated.`);
  } catch (err) {
    say('Could not update agent: ' + err.message, true);
  } finally {
    select.disabled = false;
  }
}

/* =========================================================
   2. PROPERTIES CRUD & LISTING
   ========================================================= */

function renderProperties() {
  const table = document.getElementById('propertyRows');
  if (!table) return;

  const term = (document.getElementById('propSearchBox')?.value || '').trim().toLowerCase();
  const wantedPurpose = document.getElementById('propPurposeFilter')?.value || '';
  const wantedType = document.getElementById('propTypeFilter')?.value || '';
  const wantedStatus = document.getElementById('propStatusFilter')?.value || '';

  const list = allProperties.filter(p =>
    (!wantedPurpose || p.purpose.toLowerCase() === wantedPurpose.toLowerCase()) &&
    (!wantedType || p.type.toLowerCase() === wantedType.toLowerCase()) &&
    (!wantedStatus || p.status === wantedStatus) &&
    (!term || [p.title, p.location, p.description, p.type].join(' ').toLowerCase().includes(term))
  );

  document.getElementById('propertyCountBadge').textContent = allProperties.length;

  table.innerHTML = list.map(p => {
    const photo = p.image || (p.images && p.images[0]) || 'images/apartment-1.webp';
    const isPub = Number(p.published) === 1;
    return `
      <tr class="hover:bg-gray-50/60 align-middle">
        <td class="p-4 w-20">
          <img src="${esc(photo)}" alt="${esc(p.title)}" class="w-16 h-12 rounded-lg object-cover border border-gray-200">
        </td>
        <td class="p-4">
          <a href="property-detail.html?id=${p.id}" target="_blank" class="font-bold text-navy hover:underline">${esc(p.title)}</a>
          <p class="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
            ${esc(p.location)}
          </p>
        </td>
        <td class="p-4 whitespace-nowrap">
          <span class="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-navy mr-1">${esc(p.type)}</span>
          <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-700">${esc(p.purpose)}</span>
        </td>
        <td class="p-4 font-bold text-slate-800 whitespace-nowrap">${esc(p.price)}</td>
        <td class="p-4 whitespace-nowrap">
          <select data-prop-status-id="${p.id}" class="border rounded px-2.5 py-1 text-sm font-semibold ${
            p.status === 'available' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
            p.status === 'under_offer' ? 'bg-amber-50 text-amber-800 border-amber-300' :
            p.status === 'sold' ? 'bg-red-50 text-red-800 border-red-300' :
            'bg-gray-100 text-gray-700 border-gray-300'
          }">
            ${PROPERTY_STATUSES.map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s.replace('_', ' ').toUpperCase()}</option>`).join('')}
          </select>
        </td>
        <td class="p-4 whitespace-nowrap">
          <button type="button" data-toggle-pub="${p.id}" data-pub="${isPub ? 1 : 0}" class="text-xs font-bold px-2.5 py-1 rounded-full ${isPub ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'} hover:opacity-80 transition">
            ${isPub ? 'Published' : 'Draft / Hidden'}
          </button>
        </td>
        <td class="p-4 text-right whitespace-nowrap space-x-1">
          <button type="button" data-edit-prop="${p.id}" class="border border-gray-300 text-slate-700 hover:bg-gray-100 px-3 py-1.5 rounded-lg text-sm font-semibold transition" title="Edit Property">
            Edit
          </button>
          <button type="button" data-media-prop="${p.id}" class="border border-gray-300 text-navy hover:bg-blue-50 px-3 py-1.5 rounded-lg text-sm font-semibold transition" title="Manage Photos">
            Photos
          </button>
          <button type="button" data-del-prop="${p.id}" class="border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm font-semibold transition" title="Delete">
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" class="p-8 text-center text-gray-500">No properties found.</td></tr>`;

  if (window.drawIcons) window.drawIcons();
}

async function loadProperties() {
  try {
    const res = await fetchWithTimeout('/api/properties?includeUnpublished=true');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.properties) {
      allProperties = data.properties;
      renderProperties();
      populateMediaPropertySelect();
    }
  } catch (err) {
    say('Could not load properties: ' + err.message, true);
  }
}

function openPropertyModal(prop = null) {
  const modal = document.getElementById('propertyModal');
  const titleEl = document.getElementById('propModalTitle');
  const form = document.getElementById('propertyForm');

  form.reset();
  if (prop) {
    titleEl.textContent = 'Edit Property: ' + prop.title;
    document.getElementById('propId').value = prop.id;
    document.getElementById('propTitleInput').value = prop.title || '';
    document.getElementById('propSlugInput').value = prop.slug || '';
    document.getElementById('propLocationInput').value = prop.location || '';
    document.getElementById('propPurposeSelect').value = prop.purpose || 'Rent';
    document.getElementById('propTypeSelect').value = prop.type || 'House';
    document.getElementById('propPriceInput').value = prop.price || '';
    document.getElementById('propStatusSelect').value = prop.status || 'available';
    document.getElementById('propBedsInput').value = prop.beds || '';
    document.getElementById('propBathsInput').value = prop.baths || '';
    document.getElementById('propAreaInput').value = prop.area || '';
    document.getElementById('propImageInput').value = prop.image || '';
    document.getElementById('propFeaturesInput').value = Array.isArray(prop.features) ? prop.features.join(', ') : (prop.features || '');
    document.getElementById('propDescInput').value = prop.description || '';
    document.getElementById('propFeaturedCheckbox').checked = Boolean(prop.featured);
    document.getElementById('propPublishedCheckbox').checked = Number(prop.published) === 1;
  } else {
    titleEl.textContent = 'Add New Property';
    document.getElementById('propId').value = '';
    document.getElementById('propStatusSelect').value = 'available';
    document.getElementById('propPublishedCheckbox').checked = true;
  }

  modal.classList.remove('hidden');
}

async function handleSaveProperty(e) {
  e.preventDefault();
  const id = document.getElementById('propId').value;
  const isEdit = Boolean(id);

  const payload = {
    title: document.getElementById('propTitleInput').value.trim(),
    slug: document.getElementById('propSlugInput').value.trim() || undefined,
    location: document.getElementById('propLocationInput').value.trim(),
    purpose: document.getElementById('propPurposeSelect').value,
    type: document.getElementById('propTypeSelect').value,
    price: document.getElementById('propPriceInput').value.trim(),
    status: document.getElementById('propStatusSelect').value,
    beds: document.getElementById('propBedsInput').value ? Number(document.getElementById('propBedsInput').value) : null,
    baths: document.getElementById('propBathsInput').value ? Number(document.getElementById('propBathsInput').value) : null,
    area: document.getElementById('propAreaInput').value.trim(),
    image: document.getElementById('propImageInput').value.trim() || 'images/apartment-1.webp',
    features: document.getElementById('propFeaturesInput').value.split(',').map(s => s.trim()).filter(Boolean),
    description: document.getElementById('propDescInput').value.trim(),
    featured: document.getElementById('propFeaturedCheckbox').checked ? 1 : 0,
    published: document.getElementById('propPublishedCheckbox').checked ? 1 : 0
  };

  const saveBtn = document.getElementById('savePropertyBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const url = isEdit ? `/api/properties/${id}` : '/api/properties';
    const method = isEdit ? 'PUT' : 'POST';
    const res = await fetchWithTimeout(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Failed to save property.');

    document.getElementById('propertyModal').classList.add('hidden');
    say(`Property "${payload.title}" saved successfully.`);
    await loadProperties();
  } catch (err) {
    say('Save failed: ' + err.message, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Property';
  }
}

/* =========================================================
   3. MEDIA GALLERY MANAGER
   ========================================================= */

function populateMediaPropertySelect() {
  const select = document.getElementById('mediaPropertySelect');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select a property to manage photos...</option>' +
    allProperties.map(p => `<option value="${p.id}" ${String(p.id) === String(currentVal) ? 'selected' : ''}>${esc(p.title)} (${esc(p.location)})</option>`).join('');
}

async function loadMediaForProperty(propertyId) {
  selectedPropertyForMedia = propertyId;
  const grid = document.getElementById('mediaThumbnailsGrid');
  const countEl = document.getElementById('mediaCount');
  if (!grid || !propertyId) {
    if (grid) grid.innerHTML = '<p class="text-gray-500 col-span-full py-8 text-center">Select a property above to view and upload photos.</p>';
    if (countEl) countEl.textContent = '0';
    return;
  }

  try {
    const res = await fetchWithTimeout(`/api/properties/${propertyId}`);
    const data = await res.json();
    if (!res.ok || !data.property) throw new Error('Property not found.');

    const prop = data.property;
    const images = prop.images && prop.images.length ? prop.images : (prop.image ? [{ id: 0, url: prop.image, is_cover: 1 }] : []);
    countEl.textContent = images.length;

    grid.innerHTML = images.map((img, idx) => {
      const isCover = Boolean(img.is_cover || idx === 0);
      return `
        <div class="relative group bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
          <img src="${esc(img.url)}" alt="Photo ${idx + 1}" class="w-full h-32 object-cover">
          ${isCover ? '<span class="absolute top-2 left-2 bg-amber-500 text-slate-900 text-xs font-bold px-2 py-0.5 rounded shadow">Cover</span>' : ''}
          <div class="p-2 bg-white flex items-center justify-between gap-1 text-xs">
            ${!isCover && img.id ? `<button type="button" data-set-cover="${img.id}" class="text-navy hover:underline font-bold">Make Cover</button>` : '<span></span>'}
            ${img.id ? `<button type="button" data-del-img="${img.id}" class="text-red-600 hover:underline font-bold">Delete</button>` : ''}
          </div>
        </div>
      `;
    }).join('') || '<p class="text-gray-500 col-span-full py-4 text-center">No photos yet for this property.</p>';

    if (window.drawIcons) window.drawIcons();
  } catch (err) {
    say('Failed to load photos: ' + err.message, true);
  }
}

async function handleFileUpload(file) {
  if (!selectedPropertyForMedia) {
    say('Please select a property first before uploading photos.', true);
    return;
  }
  if (!file || !file.type.startsWith('image/')) {
    say('Please choose a valid JPG, PNG, or WEBP image file.', true);
    return;
  }

  const statusText = document.getElementById('uploadStatusText');
  statusText.textContent = 'Optimizing and uploading image with Sharp...';

  try {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result;
        // Step 1: Upload and Sharp optimize
        const uploadRes = await fetchWithTimeout('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64Data, filename: file.name })
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.message || 'Image upload failed.');

        // Step 2: Attach to property
        const attachRes = await fetchWithTimeout(`/api/properties/${selectedPropertyForMedia}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: uploadData.url })
        });
        if (!attachRes.ok) throw new Error('Could not link image to property.');

        statusText.textContent = 'Upload successful!';
        say('Photo uploaded and optimized.');
        await loadMediaForProperty(selectedPropertyForMedia);
        await loadProperties();
      } catch (uploadErr) {
        statusText.textContent = '';
        say('Upload error: ' + uploadErr.message, true);
      }
    };
    reader.readAsDataURL(file);
  } catch (err) {
    statusText.textContent = '';
    say('File read failed: ' + err.message, true);
  }
}

/* =========================================================
   4. CUSTOMERS CRM
   ========================================================= */

async function loadCustomers() {
  try {
    const res = await fetchWithTimeout('/api/customers');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.customers) {
      allCustomers = data.customers;
      renderCustomers();
    }
  } catch (err) {
    // Non-fatal if session lacks permissions
  }
}

function renderCustomers() {
  const table = document.getElementById('customerRows');
  if (!table) return;

  const term = (document.getElementById('customerSearchBox')?.value || '').trim().toLowerCase();
  const list = allCustomers.filter(c =>
    !term || [c.name, c.phone, c.email, c.notes].join(' ').toLowerCase().includes(term)
  );

  document.getElementById('customerTotalCount').textContent = `${list.length} of ${allCustomers.length} customers`;

  table.innerHTML = list.map(c => {
    const digits = String(c.phone || '').replace(/\D/g, '');
    const waLink = digits ? `https://wa.me/${digits}` : '';
    return `
      <tr class="hover:bg-gray-50/60 align-middle">
        <td class="p-4 font-bold text-slate-800">${esc(c.name)}</td>
        <td class="p-4 whitespace-nowrap">
          <a class="text-navy font-semibold hover:underline" href="tel:+${digits}">${esc(c.phone)}</a>
          ${digits ? `<a href="${waLink}" target="_blank" rel="noopener" class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded font-bold hover:bg-green-200">WA</a>` : ''}
        </td>
        <td class="p-4">${c.email ? `<a class="text-blue-700 hover:underline" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="text-gray-400">None</span>'}</td>
        <td class="p-4 text-center">
          <span class="inline-block bg-slate-100 text-slate-800 font-bold px-2.5 py-0.5 rounded-full text-xs">${c.inquiries_count || 1}</span>
        </td>
        <td class="p-4 text-sm">${esc(c.assigned_agent_name || 'Unassigned')}</td>
        <td class="p-4 text-xs text-gray-500 whitespace-nowrap">${esc(when(c.created_at))}</td>
        <td class="p-4 text-right text-xs text-gray-600 max-w-xs truncate">${esc(c.notes || 'No notes')}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="p-8 text-center text-gray-500">No customers found.</td></tr>';
}

/* =========================================================
   5. TEAM & ACCESS CONTROL (RBAC)
   ========================================================= */

async function loadUsers() {
  if (currentUser.role !== 'admin') return;
  try {
    const res = await fetchWithTimeout('/api/users');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.users) {
      allUsers = data.users;
      allAgents = data.users.filter(u => u.status === 'active');
      renderUsers();
      renderInquiries(); // update agent dropdowns in inquiry table
    }
  } catch (err) {
    // Non-fatal
  }
}

function renderUsers() {
  const table = document.getElementById('userRows');
  if (!table) return;

  table.innerHTML = allUsers.map(u => `
    <tr class="hover:bg-gray-50/60 align-middle">
      <td class="p-4">
        <strong class="text-slate-800">${esc(u.name)}</strong><br>
        <span class="text-xs text-gray-500">@${esc(u.username)}</span>
      </td>
      <td class="p-4">
        <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-navy'}">${esc(u.role)}</span>
      </td>
      <td class="p-4 text-sm">${esc(u.email)}</td>
      <td class="p-4 text-sm">${esc(u.phone || '—')}</td>
      <td class="p-4">
        <span class="text-xs font-bold px-2 py-0.5 rounded ${u.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">${esc(u.status)}</span>
      </td>
      <td class="p-4 text-xs text-gray-500 whitespace-nowrap">${esc(when(u.created_at))}</td>
      <td class="p-4 text-right whitespace-nowrap">
        <button type="button" data-toggle-user="${u.id}" data-status="${u.status}" class="text-xs font-semibold px-3 py-1 border rounded hover:bg-gray-100 transition">
          ${u.status === 'active' ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="p-8 text-center text-gray-500">No users found.</td></tr>';
}

/* =========================================================
   6. SITE SETTINGS & ANNOUNCEMENT BANNER
   ========================================================= */

async function loadSettings() {
  try {
    const res = await fetchWithTimeout('/api/settings');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.settings) {
      const s = data.settings;
      if (document.getElementById('settingBannerActive')) document.getElementById('settingBannerActive').checked = s.bannerActive === '1';
      if (document.getElementById('settingBannerText')) document.getElementById('settingBannerText').value = s.bannerText || '';
      if (document.getElementById('settingBusinessName')) document.getElementById('settingBusinessName').value = s.businessName || siteConfig.businessName;
      if (document.getElementById('settingPhone')) document.getElementById('settingPhone').value = s.phone || siteConfig.phone;
      if (document.getElementById('settingWhatsApp')) document.getElementById('settingWhatsApp').value = s.whatsapp || siteConfig.whatsapp;
      if (document.getElementById('settingEmail')) document.getElementById('settingEmail').value = s.email || siteConfig.email;
      if (document.getElementById('settingAddress')) document.getElementById('settingAddress').value = s.address || siteConfig.address;
      if (document.getElementById('settingOpeningHours')) document.getElementById('settingOpeningHours').value = s.openingHours || siteConfig.openingHours;
      if (document.getElementById('settingChatDailyLimit')) document.getElementById('settingChatDailyLimit').value = s.chatDailyLimit || '60';
    }
  } catch (err) {
    // Non-fatal
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const payload = {
    bannerActive: document.getElementById('settingBannerActive').checked ? '1' : '0',
    bannerText: document.getElementById('settingBannerText').value.trim(),
    businessName: document.getElementById('settingBusinessName').value.trim(),
    phone: document.getElementById('settingPhone').value.trim(),
    whatsapp: document.getElementById('settingWhatsApp').value.trim(),
    email: document.getElementById('settingEmail').value.trim(),
    address: document.getElementById('settingAddress').value.trim(),
    openingHours: document.getElementById('settingOpeningHours').value.trim(),
    chatDailyLimit: document.getElementById('settingChatDailyLimit').value.trim()
  };

  const btn = document.getElementById('saveSettingsBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await fetchWithTimeout('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not update settings.');
    say('Website settings & announcement banner updated.');
  } catch (err) {
    say('Save failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Settings';
  }
}

/* =========================================================
   7. ANALYTICS & AUDIT LOGS
   ========================================================= */

async function loadAnalytics() {
  try {
    const res = await fetchWithTimeout('/api/analytics');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.metrics) {
      const m = data.metrics;
      document.getElementById('statTotalProps').textContent = m.totalProperties;
      document.getElementById('statActiveProps').textContent = m.activeProperties;
      document.getElementById('statTotalInquiries').textContent = m.totalInquiries;
      document.getElementById('statNewInquiries').textContent = m.newInquiries;
      document.getElementById('statTotalCustomers').textContent = m.totalCustomers;
      document.getElementById('statClosedDeals').textContent = (m.soldProperties || 0) + (m.rentedProperties || 0);
      document.getElementById('statSoldProps').textContent = m.soldProperties || 0;
      document.getElementById('statRentedProps').textContent = m.rentedProperties || 0;

      // Render status distribution bars
      const statusBars = document.getElementById('statusDistributionBars');
      if (statusBars && data.inquiriesByStatus) {
        const total = m.totalInquiries || 1;
        statusBars.innerHTML = data.inquiriesByStatus.map(s => {
          const pct = Math.round((s.count / total) * 100);
          return `
            <div>
              <div class="flex justify-between text-xs font-semibold mb-1">
                <span class="capitalize text-slate-700">${s.status}</span>
                <span class="text-gray-500">${s.count} (${pct}%)</span>
              </div>
              <div class="w-full h-2.5">
                <svg class="w-full h-2.5 rounded-full" viewBox="0 0 100 10" preserveAspectRatio="none"><rect width="100" height="10" fill="#f1f5f9" rx="5"/><rect width="${pct}" height="10" fill="#123B63" rx="5"/></svg>
              </div>
            </div>
          `;
        }).join('') || '<p class="text-sm text-gray-500">No status data.</p>';
      }

      // Render property type bars
      const typeBars = document.getElementById('propertyTypeBars');
      if (typeBars && data.propertiesByType) {
        const total = m.totalProperties || 1;
        typeBars.innerHTML = data.propertiesByType.map(t => {
          const pct = Math.round((t.count / total) * 100);
          return `
            <div>
              <div class="flex justify-between text-xs font-semibold mb-1">
                <span class="capitalize text-slate-700">${t.type}</span>
                <span class="text-gray-500">${t.count} (${pct}%)</span>
              </div>
              <div class="w-full h-2.5">
                <svg class="w-full h-2.5 rounded-full" viewBox="0 0 100 10" preserveAspectRatio="none"><rect width="100" height="10" fill="#f1f5f9" rx="5"/><rect width="${pct}" height="10" fill="#d97706" rx="5"/></svg>
              </div>
            </div>
          `;
        }).join('') || '<p class="text-sm text-gray-500">No category data.</p>';
      }

      // Render recent activity
      const activityTable = document.getElementById('recentActivityRows');
      if (activityTable && data.recentActivity) {
        activityTable.innerHTML = data.recentActivity.map(a => `
          <tr class="align-middle">
            <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${esc(when(a.created_at))}</td>
            <td class="p-3 font-semibold text-slate-800 text-xs">${esc(a.username || 'System')}</td>
            <td class="p-3 text-xs uppercase font-bold text-navy">${esc(a.action)}</td>
            <td class="p-3 text-xs text-gray-600">${esc(a.entity_type)}</td>
            <td class="p-3 text-xs text-gray-700 max-w-xs truncate">${esc(a.details)}</td>
          </tr>
        `).join('') || '<tr><td colspan="5" class="p-4 text-center text-gray-500">No recent activity.</td></tr>';
      }
    }
  } catch (err) {
    // Non-fatal
  }
}

async function loadNotificationLogs() {
  const table = document.getElementById('notificationLogRows');
  if (!table) return;

  try {
    const res = await fetchWithTimeout('/api/notifications');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.notifications) {
      table.innerHTML = data.notifications.map(n => `
        <tr class="align-middle hover:bg-gray-50">
          <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${esc(when(n.created_at))}</td>
          <td class="p-3 text-xs uppercase font-bold text-navy">${esc(n.channel)}</td>
          <td class="p-3 text-xs text-slate-800 font-semibold">${esc(n.recipient)}</td>
          <td class="p-3 text-xs text-gray-600">${esc(n.event_type)}</td>
          <td class="p-3">
            <span class="text-xs font-bold px-2 py-0.5 rounded ${
              n.status === 'sent' ? 'bg-emerald-100 text-emerald-800' :
              n.status === 'simulated_no_credentials' ? 'bg-amber-100 text-amber-900' :
              'bg-red-100 text-red-800'
            }">
              ${esc(n.status)}
            </span>
          </td>
          <td class="p-3 text-xs text-gray-600 max-w-xs truncate">${esc(n.reason || 'Delivered')}</td>
        </tr>
      `).join('') || '<tr><td colspan="6" class="p-6 text-center text-gray-500">No dispatch records found.</td></tr>';
    }
  } catch (err) {
    // Non-fatal
  }
}

/* =========================================================
   8. CORE DATA LOAD & AUTHENTICATION
   ========================================================= */

async function load() {
  if (!currentKey && !currentToken) {
    say('Enter your admin key or login credentials.', true);
    return;
  }

  say('Loading Danny Agent Admin Portal...');
  try {
    const res = await fetchWithTimeout('/api/inquiries');
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw Object.assign(new Error('That admin key is not correct.'), { signOut: true });
    }
    if (!res.ok) throw new Error(data.message || 'Could not load enquiries.');

    allInquiries = data.inquiries || [];
    showSignedIn(true);
    renderInquiries();

    // Persist key or token
    try {
      if (currentKey) sessionStorage.setItem(SESSION_KEY, currentKey);
      if (currentToken) sessionStorage.setItem(SESSION_TOKEN_KEY, currentToken);
      sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(currentUser));
    } catch (e) {}

    // Load other tabs in background
    loadProperties();
    loadAnalytics();
    loadCustomers();
    loadUsers();
    loadSettings();
    loadNotificationLogs();

  } catch (error) {
    if (error.signOut) signOut(false);
    say(error.network ? error.message + ' Check your connection and try again.' : error.message, true);
  }
}

/* =========================================================
   9. EVENT LISTENERS & INITIALIZATION
   ========================================================= */

// Tab Switching
document.getElementById('adminTabs')?.addEventListener('click', event => {
  const btn = event.target.closest('[data-tab]');
  if (!btn) return;
  const targetTab = btn.dataset.tab;

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('bg-navy', 'text-white');
    b.classList.add('text-gray-600');
  });
  btn.classList.add('bg-navy', 'text-white');
  btn.classList.remove('text-gray-600');

  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
  const panel = document.getElementById(`tab-${targetTab}-content`);
  if (panel) panel.classList.remove('hidden');

  if (window.drawIcons) window.drawIcons();
});

// Inquiry Interactions
rows?.addEventListener('change', event => {
  if (event.target.classList.contains('status')) updateStatus(event.target);
  if (event.target.classList.contains('agent-assign')) updateInquiryAssignment(event.target);
});

rows?.addEventListener('click', event => {
  const noteBtn = event.target.closest('[data-note-id]');
  if (noteBtn) {
    const id = Number(noteBtn.dataset.noteId);
    const item = allInquiries.find(i => i.id === id);
    if (!item) return;

    const modal = document.getElementById('notesModal');
    document.getElementById('notesModalTitle').textContent = `Notes for ENQ-${item.id}: ${item.name}`;
    document.getElementById('notesLeadInfo').innerHTML = `
      <p><strong>Customer:</strong> ${esc(item.name)} (${esc(item.phone)})</p>
      <p><strong>Property:</strong> ${esc(item.property_title || 'General enquiry')}</p>
      <p><strong>Message:</strong> ${esc(item.message)}</p>
    `;
    document.getElementById('internalNotesText').value = item.notes || '';
    document.getElementById('saveNotesBtn').onclick = async () => {
      const notes = document.getElementById('internalNotesText').value.trim();
      try {
        const res = await fetchWithTimeout(`/api/inquiries/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes })
        });
        if (!res.ok) throw new Error('Could not save note.');
        item.notes = notes;
        renderInquiries();
        modal.classList.add('hidden');
        say('Note saved.');
      } catch (err) {
        say('Failed to save note: ' + err.message, true);
      }
    };
    modal.classList.remove('hidden');
  }
});

// Property Table Interactions
document.getElementById('propertyRows')?.addEventListener('click', async event => {
  const editBtn = event.target.closest('[data-edit-prop]');
  if (editBtn) {
    const id = Number(editBtn.dataset.editProp);
    const prop = allProperties.find(p => p.id === id);
    if (prop) openPropertyModal(prop);
    return;
  }

  const mediaBtn = event.target.closest('[data-media-prop]');
  if (mediaBtn) {
    const id = Number(mediaBtn.dataset.mediaProp);
    const tabMediaBtn = document.querySelector('[data-tab="media"]');
    if (tabMediaBtn) tabMediaBtn.click();
    const mediaSelect = document.getElementById('mediaPropertySelect');
    if (mediaSelect) {
      mediaSelect.value = id;
      loadMediaForProperty(id);
    }
    return;
  }

  const delBtn = event.target.closest('[data-del-prop]');
  if (delBtn) {
    const id = Number(delBtn.dataset.delProp);
    const prop = allProperties.find(p => p.id === id);
    if (!confirm(`Are you sure you want to delete or archive "${prop?.title || 'this property'}"?`)) return;
    try {
      const res = await fetchWithTimeout(`/api/properties/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed.');
      say(`Property ${id} deleted.`);
      await loadProperties();
    } catch (err) {
      say('Delete error: ' + err.message, true);
    }
    return;
  }

  const pubBtn = event.target.closest('[data-toggle-pub]');
  if (pubBtn) {
    const id = Number(pubBtn.dataset.togglePub);
    const currentPub = Number(pubBtn.dataset.pub) === 1;
    try {
      const res = await fetchWithTimeout(`/api/properties/${id}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !currentPub })
      });
      if (!res.ok) throw new Error('Status update failed.');
      say(`Property publication status changed.`);
      await loadProperties();
    } catch (err) {
      say('Error: ' + err.message, true);
    }
  }
});

document.getElementById('propertyRows')?.addEventListener('change', async event => {
  const statusSel = event.target.closest('[data-prop-status-id]');
  if (statusSel) {
    const id = Number(statusSel.dataset.propStatusId);
    const status = statusSel.value;
    try {
      const res = await fetchWithTimeout(`/api/properties/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Status update failed.');
      say(`Property status set to ${status}.`);
      await loadProperties();
    } catch (err) {
      say('Error: ' + err.message, true);
    }
  }
});

// Media Gallery Interactions
document.getElementById('mediaPropertySelect')?.addEventListener('change', e => {
  loadMediaForProperty(Number(e.target.value));
});

const uploadBox = document.getElementById('mediaUploadBox');
const fileInput = document.getElementById('mediaFileInput');

uploadBox?.addEventListener('click', () => fileInput.click());
fileInput?.addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) handleFileUpload(e.target.files[0]);
});

uploadBox?.addEventListener('dragover', e => { e.preventDefault(); uploadBox.classList.add('border-navy'); });
uploadBox?.addEventListener('dragleave', () => uploadBox.classList.remove('border-navy'));
uploadBox?.addEventListener('drop', e => {
  e.preventDefault();
  uploadBox.classList.remove('border-navy');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

document.getElementById('mediaThumbnailsGrid')?.addEventListener('click', async event => {
  const delImg = event.target.closest('[data-del-img]');
  if (delImg && selectedPropertyForMedia) {
    const imgId = Number(delImg.dataset.delImg);
    if (!confirm('Remove this photo from the gallery?')) return;
    try {
      const res = await fetchWithTimeout(`/api/properties/${selectedPropertyForMedia}/images/${imgId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete image.');
      say('Photo removed.');
      loadMediaForProperty(selectedPropertyForMedia);
    } catch (err) {
      say('Photo delete error: ' + err.message, true);
    }
    return;
  }

  const coverBtn = event.target.closest('[data-set-cover]');
  if (coverBtn && selectedPropertyForMedia) {
    const imgId = Number(coverBtn.dataset.setCover);
    try {
      // Re-assign cover
      const res = await fetchWithTimeout(`/api/properties/${selectedPropertyForMedia}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverImageId: imgId })
      });
      say('Cover image updated.');
      loadMediaForProperty(selectedPropertyForMedia);
      loadProperties();
    } catch (err) {
      say('Could not set cover: ' + err.message, true);
    }
  }
});

// Modals management
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#propertyModal, #userModal, #notesModal').forEach(m => m.classList.add('hidden'));
  });
});

document.getElementById('addPropertyBtn')?.addEventListener('click', () => openPropertyModal());
document.getElementById('propertyForm')?.addEventListener('submit', handleSaveProperty);
document.getElementById('settingsForm')?.addEventListener('submit', handleSaveSettings);

// Team Management
document.getElementById('addUserBtn')?.addEventListener('click', () => {
  document.getElementById('userForm')?.reset();
  document.getElementById('userModal')?.classList.remove('hidden');
});

document.getElementById('userForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('userNameInput').value.trim(),
    username: document.getElementById('userUsernameInput').value.trim(),
    email: document.getElementById('userEmailInput').value.trim(),
    password: document.getElementById('userPasswordInput').value,
    role: document.getElementById('userRoleSelect').value
  };

  try {
    const res = await fetchWithTimeout('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not create account.');
    document.getElementById('userModal').classList.add('hidden');
    say(`Account for ${payload.name} created.`);
    loadUsers();
  } catch (err) {
    say('Create account failed: ' + err.message, true);
  }
});

document.getElementById('userRows')?.addEventListener('click', async event => {
  const toggleBtn = event.target.closest('[data-toggle-user]');
  if (toggleBtn) {
    const id = Number(toggleBtn.dataset.toggleUser);
    const newStatus = toggleBtn.dataset.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetchWithTimeout(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error('Could not update user status.');
      say('User status updated.');
      loadUsers();
    } catch (err) {
      say('Error: ' + err.message, true);
    }
  }
});

// Refresh & Signout
document.getElementById('refreshBtn')?.addEventListener('click', () => {
  load();
});

document.getElementById('refreshLogsBtn')?.addEventListener('click', () => {
  loadNotificationLogs();
  say('Notification logs refreshed.');
});

document.getElementById('signOutBtn')?.addEventListener('click', async () => {
  if (currentToken) {
    try { await fetchWithTimeout('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  }
  signOut();
});

// Login Form Submit
loginForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const val = keyInput.value.trim();
  if (!val) {
    say('Please enter your admin key or password.', true);
    return;
  }

  // If input looks like username or password, attempt /api/auth/login first
  if (val.includes('@') || val.length > 20) {
    try {
      const res = await fetchWithTimeout('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: val, password: val })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        currentToken = data.token;
        currentUser = data.user || { role: 'admin' };
        currentKey = '';
        load();
        return;
      }
    } catch (_) {}
  }

  // Default: attempt as admin key
  currentKey = val;
  currentToken = '';
  currentUser = { role: 'admin', name: 'Administrator' };
  load();
});

// Search & Filter listeners
searchBox?.addEventListener('input', renderInquiries);
statusFilter?.addEventListener('change', renderInquiries);
serviceFilter?.addEventListener('change', renderInquiries);

document.getElementById('propSearchBox')?.addEventListener('input', renderProperties);
document.getElementById('propPurposeFilter')?.addEventListener('change', renderProperties);
document.getElementById('propTypeFilter')?.addEventListener('change', renderProperties);
document.getElementById('propStatusFilter')?.addEventListener('change', renderProperties);

document.getElementById('customerSearchBox')?.addEventListener('input', renderCustomers);

// First-Login Password Change Form
const firstLoginForm = document.getElementById('firstLoginForm');
firstLoginForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const currentPassword = document.getElementById('firstLoginCurrent').value;
  const newPassword = document.getElementById('firstLoginNew').value;
  const confirmPassword = document.getElementById('firstLoginConfirm').value;
  const errEl = document.getElementById('firstLoginError');
  errEl.classList.add('hidden');

  if (newPassword !== confirmPassword) {
    errEl.textContent = 'New passwords do not match.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPassword.length < 10) {
    errEl.textContent = 'New password must be at least 10 characters long.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetchWithTimeout('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.message || 'Failed to update password.';
      errEl.classList.remove('hidden');
      return;
    }
    currentUser.mustChangePassword = false;
    try { sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(currentUser)); } catch (e) {}
    checkMustChangePassword();
    say('Password updated successfully. Full dashboard access granted.', false);
  } catch (err) {
    errEl.textContent = 'Network error. Please try again.';
    errEl.classList.remove('hidden');
  }
});

// Initial start: if key or token saved in tab, load immediately
if (currentKey || currentToken) {
  load();
}
