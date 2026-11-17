const favoritesGrid = document.getElementById("favoritesGrid");
const favoritesActions = document.getElementById("favoritesActions");
const resultsCount = document.getElementById("resultsCount");

/* Saved properties, in the order they were saved */
function getSavedProperties() {
    return getFavorites()
        .map(id => properties.find(property => property.id === id))
        .filter(Boolean);
}

/* Forget saved ids whose listing no longer exists (sold, rented or removed) */
function pruneFavorites() {
    const valid = new Set(properties.map(property => property.id));
    const saved = getFavorites();
    const kept = saved.filter(id => valid.has(id));
    if (kept.length !== saved.length) saveFavorites(kept);
}

function whatsappLink(list) {
    const number = String(siteConfig.whatsapp || "").replace(/\D/g, "");
    if (!number) return "";
    const lines = list.map((property, index) =>
        `${index + 1}. ${property.title}, ${property.location}, ${property.price}\n${window.location.origin}/property-detail.html?id=${property.id}`
    );
    const message = "Hello, I would like more information about these properties I saved:\n\n" + lines.join("\n\n");
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function renderFavorites() {
    pruneFavorites();
    const list = getSavedProperties();

    resultsCount.textContent =
        `${list.length} ${list.length === 1 ? "saved property" : "saved properties"}`;
    updateFavoritesCount();

    if (list.length === 0) {
        favoritesActions.innerHTML = "";
        favoritesGrid.innerHTML = `
            <div class="col-span-full text-center py-20 bg-white rounded-2xl border border-gray-100">
                <div class="w-20 h-20 rounded-full bg-lightgold text-gold flex items-center justify-center mx-auto">
                    <i data-lucide="heart" class="w-9 h-9"></i>
                </div>
                <h3 class="text-2xl font-bold text-navy mt-6">No Saved Properties Yet</h3>
                <p class="text-gray-500 max-w-md mx-auto mt-3">
                    When you find a property you like, click the heart icon to save it here.
                </p>
                <a href="properties.html" class="inline-flex items-center gap-2 bg-navy text-white px-6 py-3 rounded-lg font-semibold mt-7 hover:bg-darknavy transition">
                    Explore Properties
                    <i data-lucide="arrow-right" class="w-5 h-5"></i>
                </a>
            </div>
        `;
        drawIcons();
        return;
    }

    const link = whatsappLink(list);
    favoritesActions.innerHTML = `
        <div class="flex flex-wrap items-center gap-4">
            ${link ? `
                <a href="${esc(link)}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 bg-green-600 text-white px-5 py-3 rounded-lg font-semibold hover:bg-green-700 transition">
                    <i data-lucide="message-circle" class="w-5 h-5"></i>
                    Ask about these on WhatsApp
                </a>` : ""}
            <span class="text-xs text-gray-400">Saved on this device only.</span>
        </div>
    `;

    favoritesGrid.innerHTML = list.map(property => {
        const detailUrl = `property-detail.html?id=${encodeURIComponent(property.id)}`;
        return `
            <article class="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl transition">
                <div class="h-56 bg-gray-100 relative overflow-hidden">
                    <a href="${detailUrl}" aria-label="View ${esc(property.title)}">
                        <img
                            src="${esc(photoUrl(property.image, 800))}"
                            srcset="${esc(photoSrcset(property.image))}"
                            sizes="(min-width: 1024px) 400px, (min-width: 768px) 45vw, 100vw"
                            alt="${esc(property.title)}"
                            loading="lazy"
                            decoding="async"
                            class="w-full h-full object-cover"
                        >
                    </a>
                    <span class="absolute top-4 left-4 bg-white text-navy text-xs font-bold px-3 py-1.5 rounded-full">${esc(property.purpose)}</span>
                    <button
                        type="button"
                        data-remove="${property.id}"
                        class="absolute top-4 right-4 w-10 h-10 bg-white rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 transition"
                        aria-label="Remove ${esc(property.title)} from favorites"
                    >
                        <i data-lucide="heart-off" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="p-6">
                    <p class="text-xs uppercase tracking-wider font-bold text-gold">${esc(property.type)}</p>
                    <h3 class="text-xl font-bold text-navy mt-2">
                        <a href="${detailUrl}" class="hover:text-gold transition">${esc(property.title)}</a>
                    </h3>
                    <div class="flex items-center gap-2 text-sm text-gray-500 mt-3">
                        <i data-lucide="map-pin" class="w-4 h-4"></i>
                        ${esc(property.location)}
                    </div>
                    <div class="flex gap-4 text-sm text-gray-500 mt-4 pt-4 border-t">
                        ${property.beds ? `<span>${property.beds} Beds</span>` : ""}
                        ${property.baths ? `<span>${property.baths} Baths</span>` : ""}
                        <span>${esc(property.area)}</span>
                    </div>
                    <div class="flex items-center justify-between gap-4 mt-5">
                        <p class="text-lg font-bold text-navy">${esc(property.price)}</p>
                        <a href="${detailUrl}" class="text-sm font-bold text-gold hover:text-navy transition">View Details</a>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    drawIcons();
}

/* Removing a favorite updates the page in place (no reload) */
favoritesGrid.addEventListener("click", event => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const id = Number(button.dataset.remove);
    saveFavorites(getFavorites().filter(item => item !== id));
    renderFavorites();
});

/* Stay in sync if favorites change in another tab or after using the back button */
window.addEventListener("storage", renderFavorites);
window.addEventListener("pageshow", event => {
    if (event.persisted) renderFavorites();
});

drawIcons();
renderFavorites();
