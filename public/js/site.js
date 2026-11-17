/* =========================================================
   SHARED CODE USED BY EVERY PAGE
   Load after properties.js and site-config.js:
     <script src="js/site.js"></script>
   Handles: icons, the mobile menu, and saved favorites.
   ========================================================= */

const FAVORITES_KEY = "dannyAngelFavorites";

/* ---------- Icons ----------
   js/icons.js holds the few icons the site uses. This replaces every
   <i data-lucide="name"></i> with an inline SVG. Safe to call many times. */
const SVG_NS = "http://www.w3.org/2000/svg";

function drawIcons(root) {
    const icons = window.SITE_ICONS || {};
    (root || document).querySelectorAll("i[data-lucide]").forEach(placeholder => {
        const name = placeholder.getAttribute("data-lucide");
        const nodes = icons[name];

        if (!nodes) {
            /* Unknown icon: leave a quiet empty box instead of breaking the page */
            placeholder.removeAttribute("data-lucide");
            if (window.console) console.warn("Missing icon: " + name + " (run npm run build)");
            return;
        }

        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("xmlns", SVG_NS);
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");

        nodes.forEach(([tag, attributes]) => {
            const child = document.createElementNS(SVG_NS, tag);
            Object.keys(attributes).forEach(key => child.setAttribute(key, attributes[key]));
            svg.appendChild(child);
        });

        /* Keep the classes the page gave the placeholder (sizes, colours) */
        svg.setAttribute("class", ("lucide lucide-" + name + " " + (placeholder.getAttribute("class") || "")).trim());
        if (!placeholder.hasAttribute("aria-label")) svg.setAttribute("aria-hidden", "true");
        else {
            svg.setAttribute("aria-label", placeholder.getAttribute("aria-label"));
            svg.setAttribute("role", "img");
        }

        placeholder.replaceWith(svg);
    });
}

/* ---------- Photos that fail to load ----------
   One listener for every <img> on the page. Replaces a missing photo with a plain
   "Photo coming soon" picture, once, so a broken file can never loop. */
const PLACEHOLDER_IMAGE =
    "data:image/svg+xml," + encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'><rect width='100%' height='100%' fill='#123B63'/><text x='50%' y='50%' fill='#ffffff' fill-opacity='0.6' font-family='sans-serif' font-size='42' text-anchor='middle'>Photo coming soon</text></svg>"
    );

document.addEventListener("error", event => {
    const img = event.target;
    if (!img || img.tagName !== "IMG" || img.dataset.failed) return;
    img.dataset.failed = "1";
    img.removeAttribute("srcset");
    img.src = PLACEHOLDER_IMAGE;
}, true);

/* Smaller copies of a photo for phones. The server makes them on first request
   (see server/server.js). Pass the photo path as written in properties.js. */
const PHOTO_WIDTHS = [480, 800, 1200];

function photoUrl(path, width) {
    const match = /^images\/([A-Za-z0-9._-]+\.(?:jpe?g|png|webp))$/i.exec(String(path || ""));
    return match ? `images/w/${width}/${match[1]}` : path;
}

function photoSrcset(path) {
    if (!/^images\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(String(path || ""))) return "";
    return PHOTO_WIDTHS.map(width => `${photoUrl(path, width)} ${width}w`).join(", ");
}

/* Makes text safe to place inside HTML. */
function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
}

/* ---------- Favorites (saved in this browser only) ---------- */

function getFavorites() {
    try {
        const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY));
        return Array.isArray(saved) ? saved.map(Number) : [];
    } catch (error) {
        return [];
    }
}

function isFavorite(propertyId) {
    return getFavorites().includes(Number(propertyId));
}

function saveFavorites(list) {
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    } catch (error) { /* storage blocked: the heart still changes for this visit */ }
}

/* Saved ids that still match a listing (a removed listing is not counted) */
function validFavoriteIds() {
    const saved = getFavorites();
    if (typeof properties === "undefined") return saved;
    const valid = new Set(properties.map(property => property.id));
    return saved.filter(id => valid.has(id));
}

function updateFavoritesCount() {
    const total = validFavoriteIds().length;
    document.querySelectorAll("[data-favorites-count]").forEach(el => {
        el.textContent = total;
    });
}

/* Adds or removes a property from favorites and updates the heart button. */
function toggleFavorite(propertyId, button) {
    const id = Number(propertyId);
    const wasSaved = isFavorite(id);
    const favorites = getFavorites();

    saveFavorites(wasSaved ? favorites.filter(item => item !== id) : favorites.concat(id));

    if (button) {
        button.classList.toggle("text-red-500", !wasSaved);
        button.setAttribute("aria-pressed", String(!wasSaved));
        button.setAttribute("aria-label", wasSaved ? "Add to favorites" : "Remove from favorites");
        const icon = button.querySelector("svg") || button.querySelector("i");
        if (icon) icon.classList.toggle("fill-current", !wasSaved);
    }

    updateFavoritesCount();
    return !wasSaved;
}

/* ---------- Mobile menu ---------- */

(function setupMobileMenu() {
    const button = document.getElementById("menuButton");
    const menu = document.getElementById("mobileMenu");
    if (!button || !menu) return;

    function setMenu(open) {
        menu.classList.toggle("hidden", !open);
        button.setAttribute("aria-expanded", String(open));
    }

    button.addEventListener("click", () => setMenu(menu.classList.contains("hidden")));
    menu.querySelectorAll("a").forEach(link => link.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") setMenu(false);
    });
})();

/* ---------- Offline notice ----------
   Shown when the phone loses its connection, hidden when it returns. */
(function setupOfflineNotice() {
    const banner = document.createElement("div");
    banner.id = "offlineNotice";
    banner.setAttribute("role", "status");
    banner.className = "hidden fixed bottom-0 inset-x-0 z-[200] bg-red-700 text-white text-sm text-center px-4 py-3";
    banner.textContent = "You are offline. Some things may not work until your connection returns.";
    document.body.appendChild(banner);

    function update() {
        banner.classList.toggle("hidden", navigator.onLine !== false);
    }
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
})();

/* ---------- Start-up ---------- */

updateFavoritesCount();
window.addEventListener("storage", updateFavoritesCount);
window.addEventListener("pageshow", updateFavoritesCount);

/* =====================================
   NETWORK REQUESTS THAT GIVE UP
   A request on a weak connection can hang for minutes. This one stops after 15 seconds
   and throws an error with network = true, so every page can show the same message.
===================================== */
async function fetchWithTimeout(url, options = {}, ms = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        const failure = new Error(error && error.name === "AbortError"
            ? "The connection is too slow."
            : "Could not reach the server.");
        failure.network = true;
        throw failure;
    } finally {
        clearTimeout(timer);
    }
}
