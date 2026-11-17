const SESSION_KEY = 'adminKeyForThisTab';
const STATUSES = ['new', 'contacted', 'qualified', 'closed'];
const SERVICE_LABELS = {
  buy: 'Buying', rent: 'Renting', sell: 'Selling',
  investment: 'Investment', management: 'Management', other: 'Other'
};

const keyInput = document.getElementById('adminKey');
const statusEl = document.getElementById('status');
const rows = document.getElementById('inquiryRows');
const searchBox = document.getElementById('searchBox');
const statusFilter = document.getElementById('statusFilter');
let all = [];
let truncated = 0;

/* Gives up after 15 seconds instead of hanging on a weak connection */
async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    const failure = new Error(error && error.name === 'AbortError' ? 'The connection is too slow.' : 'Could not reach the server.');
    failure.network = true;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

document.getElementById('brand').textContent = siteConfig.businessName + ' admin';
document.title = 'Admin Enquiries | ' + siteConfig.businessName;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function say(text, bad) {
  statusEl.textContent = text;
  statusEl.className = 'mb-4 text-sm ' + (bad ? 'text-red-600' : 'text-gray-600');
}

function getKey() {
  try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
}
function setKey(value) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, value); else sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { /* storage blocked: key lives only for this page view */ }
}
let currentKey = getKey();

function showSignedIn(isIn) {
  document.getElementById('loginForm').classList.toggle('hidden', isIn);
  document.getElementById('sessionBar').classList.toggle('hidden', !isIn);
  document.getElementById('tools').classList.toggle('hidden', !isIn);
}

function when(value) {
  /* SQLite stores UTC as "YYYY-MM-DD HH:MM:SS"; mark it as UTC so local time is right */
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  return isNaN(date) ? String(value || '') : date.toLocaleString();
}

function contactLinks(item) {
  const digits = String(item.phone || '').replace(/\D/g, '');
  const phone = digits ? `<a class="text-blue-700 hover:underline" href="tel:+${esc(digits)}">${esc(item.phone)}</a>` : esc(item.phone);
  const wa = digits ? ` <a class="text-green-700 hover:underline" target="_blank" rel="noopener" href="https://wa.me/${esc(digits)}">WhatsApp</a>` : '';
  const mail = item.email ? `<a class="text-blue-700 hover:underline break-all" href="mailto:${esc(encodeURI(item.email))}">${esc(item.email)}</a>` : '';
  return `<strong>${esc(item.name)}</strong><br>${phone}${wa}<br>${mail}`;
}

function render() {
  const term = searchBox.value.trim().toLowerCase();
  const wanted = statusFilter.value;
  const list = all.filter(item =>
    (!wanted || item.status === wanted) &&
    (!term || [item.name, item.phone, item.email, item.property_title, item.property_location, item.location, item.message, item.service]
      .join(' ').toLowerCase().includes(term))
  );

  rows.innerHTML = list.map(item => `
    <tr class="border-t align-top ${item.status === 'new' ? 'bg-amber-50' : ''}">
      <td class="p-4 whitespace-nowrap">${esc(when(item.created_at))}<br><span class="text-gray-400">ENQ-${esc(item.id)}</span></td>
      <td class="p-4">${contactLinks(item)}</td>
      <td class="p-4">${esc(item.property_title || 'General enquiry')}<br><span class="text-gray-500">${esc(item.property_location || item.location || '')}</span>${item.budget ? `<br><span class="text-gray-500">Budget: ${esc(item.budget)}</span>` : ''}</td>
      <td class="p-4">${esc(SERVICE_LABELS[item.service] || item.service)}</td>
      <td class="p-4 max-w-md whitespace-pre-wrap">${esc(item.message)}</td>
      <td class="p-4">
        <select data-id="${esc(item.id)}" data-previous="${esc(item.status)}" aria-label="Status for enquiry ${esc(item.id)}" class="status border rounded px-2 py-1">
          ${STATUSES.map(s => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('') || `<tr><td colspan="6" class="p-8 text-left text-gray-500">${all.length ? 'No enquiries match your search.' : 'No enquiries yet.'}</td></tr>`;

  const fresh = all.filter(item => item.status === 'new').length;
  say(`${list.length} of ${all.length} enquiries shown. ${fresh} new.`);
}

async function load() {
  if (!currentKey) { say('Enter your admin key.', true); return; }
  say('Loading...');
  try {
    const res = await fetchWithTimeout('/api/inquiries', { headers: { 'x-admin-key': currentKey } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error('That admin key is not correct.'), { signOut: true });
    if (!res.ok) throw new Error(data.message || 'Could not load enquiries.');
    all = data.inquiries;
    truncated = data.truncated ? data.total : 0;
    setKey(currentKey);
    showSignedIn(true);
    render();
    if (truncated) say(`Showing the newest ${all.length} of ${truncated} enquiries. Older ones are still saved in the database.`);
  } catch (error) {
    if (error.signOut) { signOut(false); }
    say(error.network ? error.message + ' Check your connection and try again.' : error.message, true);
  }
}

async function updateStatus(select) {
  const id = Number(select.dataset.id);
  const previous = select.dataset.previous;
  const next = select.value;
  select.disabled = true;
  try {
    const res = await fetchWithTimeout(`/api/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': currentKey },
      body: JSON.stringify({ status: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not save the status.');
    const item = all.find(entry => entry.id === id);
    if (item) item.status = next;
    select.dataset.previous = next;
    render();
  } catch (error) {
    /* The change did NOT save: put the old value back and say so */
    select.value = previous;
    say('Status NOT saved: ' + (error.network ? error.message.toLowerCase() : error.message), true);
  } finally {
    select.disabled = false;
  }
}

function signOut(clearMessage = true) {
  currentKey = '';
  setKey('');
  all = [];
  keyInput.value = '';
  showSignedIn(false);
  rows.innerHTML = '<tr><td colspan="6" class="p-8 text-left text-gray-500">Enter your admin key and press Load.</td></tr>';
  if (clearMessage) say('Signed out.');
}

rows.addEventListener('change', event => {
  if (event.target.classList.contains('status')) updateStatus(event.target);
});
document.getElementById('loginForm').addEventListener('submit', event => {
  event.preventDefault();
  currentKey = keyInput.value.trim();
  load();
});
document.getElementById('refreshBtn').addEventListener('click', load);
document.getElementById('signOutBtn').addEventListener('click', () => signOut());
searchBox.addEventListener('input', render);
statusFilter.addEventListener('change', render);

if (currentKey) load();
