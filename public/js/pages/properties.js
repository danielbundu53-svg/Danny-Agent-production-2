/* =====================================
   ELEMENTS
===================================== */
const searchInput = document.getElementById("searchInput");
const purposeFilter = document.getElementById("purposeFilter");
const typeFilter = document.getElementById("typeFilter");
const locationFilter = document.getElementById("locationFilter");
const bedroomsFilter = document.getElementById("bedroomsFilter");
const availabilityFilter = document.getElementById("availabilityFilter");
const priceFilter = document.getElementById("priceFilter");
const propertyGrid = document.getElementById("propertyGrid");
const resultsTitle = document.getElementById("resultsTitle");
const resultsCount = document.getElementById("resultsCount");
const sectionNav = document.getElementById("sectionNav");

/* =====================================
   PROPERTY CARDS
===================================== */
function cardHtml(property, favorites) {
        const saved = favorites.includes(property.id);
        const detailUrl = `property-detail.html?id=${encodeURIComponent(property.id)}`;
        const statusBadge = property.status === 'under_offer'
            ? '<span class="bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">Under Offer</span>'
            : property.status === 'sold'
            ? '<span class="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">Sold</span>'
            : property.status === 'rented'
            ? '<span class="bg-slate-700 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">Rented</span>'
            : '';

        return `
        <article class="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition duration-300 border border-gray-100 group">
            <div class="relative h-64 bg-gray-100 overflow-hidden">
                <a href="${detailUrl}" aria-label="View ${esc(property.title)}">
                    <img
                        src="${esc(photoUrl(property.image, 800))}"
                        srcset="${esc(photoSrcset(property.image))}"
                        sizes="(min-width: 1024px) 400px, (min-width: 768px) 45vw, 100vw"
                        alt="${esc(property.title)}"
                        loading="lazy"
                        decoding="async"
                        class="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    >
                </a>
                <div class="absolute top-4 left-4 flex flex-wrap gap-2">
                    ${statusBadge}
                    <span class="bg-white/95 text-navy text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">${esc(property.purpose)}</span>
                    <span class="bg-navy/95 text-white text-xs font-bold px-3 py-1.5 rounded-full">${esc(property.type)}</span>
                </div>
                <button
                    type="button"
                    data-fav="${property.id}"
                    class="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/95 flex items-center justify-center shadow-sm ${saved ? "text-red-500" : "text-gray-600"} hover:text-red-500 transition"
                    aria-pressed="${saved}"
                    aria-label="${saved ? "Remove from favorites" : "Add to favorites"}"
                >
                    <i data-lucide="heart" class="w-5 h-5 ${saved ? "fill-current" : ""}"></i>
                </button>
            </div>
            <div class="p-6">
                <p class="text-sm text-gray-500 flex items-center gap-2">
                    <i data-lucide="map-pin" class="w-4 h-4"></i>
                    ${esc(property.location)}
                </p>
                <h4 class="text-xl font-bold text-navy mt-3">
                    <a href="${detailUrl}" class="hover:text-gold transition">${esc(property.title)}</a>
                </h4>
                <div class="flex flex-wrap gap-4 text-sm text-gray-500 mt-4">
                    ${property.beds ? `<span class="flex items-center gap-1.5"><i data-lucide="bed-double" class="w-4 h-4"></i>${property.beds} Beds</span>` : ""}
                    ${property.baths ? `<span class="flex items-center gap-1.5"><i data-lucide="bath" class="w-4 h-4"></i>${property.baths} Baths</span>` : ""}
                    <span class="flex items-center gap-1.5"><i data-lucide="ruler" class="w-4 h-4"></i>${esc(property.area)}</span>
                </div>
                <div class="flex items-center justify-between gap-4 mt-6 pt-5 border-t border-gray-100">
                    <p class="text-xl font-bold text-navy">${esc(property.price)}</p>
                    <a href="${detailUrl}" class="bg-navy text-white px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-darknavy transition">View Details</a>
                </div>
            </div>
        </article>
        `;
}

const emptyHtml = `
    <div class="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
        <i data-lucide="search-x" class="w-12 h-12 mx-auto text-gray-300"></i>
        <h3 class="text-xl font-bold text-navy mt-5">No properties found</h3>
        <p class="text-gray-500 mt-2">Try changing your search or filter options.</p>
        <button type="button" data-clear-filters class="mt-6 bg-navy text-white px-5 py-3 rounded-lg font-semibold hover:bg-darknavy transition">Clear Filters</button>
    </div>
`;

/* Shows the listings grouped in sections: apartments, houses, offices, land.
   A section with no matching listing is left out. */
function renderProperties(propertyList) {
    const total = propertyList.length;
    resultsCount.textContent = `${total} ${total === 1 ? "property" : "properties"} found`;

    if (total === 0) {
        sectionNav.innerHTML = "";
        propertyGrid.innerHTML = emptyHtml;
        drawIcons();
        return;
    }

    const favorites = getFavorites();
    const visibleIds = new Set(propertyList.map(property => property.id));
    const filled = propertySections
        .map(section => ({ ...section, items: section.list.filter(property => visibleIds.has(property.id)) }))
        .filter(section => section.items.length > 0);

    sectionNav.innerHTML = filled.map(section => `
        <a href="#${section.key}" class="inline-flex items-center gap-2 min-h-[44px] bg-white border border-gray-200 text-navy font-semibold text-sm px-4 rounded-full hover:border-gold hover:text-gold transition">
            ${esc(section.title)}
            <span class="bg-lightgold text-navy text-xs font-bold px-2 py-0.5 rounded-full">${section.items.length}</span>
        </a>
    `).join("");

    propertyGrid.innerHTML = filled.map(section => `
        <section id="${section.key}" class="scroll-mt-28" aria-labelledby="${section.key}-title">
            <div class="flex flex-wrap items-end justify-between gap-2 mb-6 pb-4 border-b border-gray-200">
                <div>
                    <h3 id="${section.key}-title" class="text-2xl font-bold text-navy">${esc(section.title)}</h3>
                    <p class="text-sm text-gray-500 mt-1">${esc(section.blurb)}</p>
                </div>
                <p class="text-sm font-medium text-gray-500">${section.items.length} ${section.items.length === 1 ? "listing" : "listings"}</p>
            </div>
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                ${section.items.map(property => cardHtml(property, favorites)).join("")}
            </div>
        </section>
    `).join("");

    drawIcons();
}

/* One listener handles every heart and the "Clear Filters" button */
propertyGrid.addEventListener("click", event => {
    const heart = event.target.closest("[data-fav]");
    if (heart) {
        toggleFavorite(Number(heart.dataset.fav), heart);
        return;
    }
    if (event.target.closest("[data-clear-filters]")) clearAllFilters();
});

/* =====================================
   FILTER SYSTEM
===================================== */
function filterProperties() {
    const search = searchInput.value.toLowerCase().trim();
    const purpose = purposeFilter.value;
    const type = typeFilter.value;
    const location = locationFilter.value.toLowerCase().trim();
    const bedrooms = bedroomsFilter ? bedroomsFilter.value : "";
    const availability = availabilityFilter ? availabilityFilter.value : "";
    const priceRange = priceFilter ? priceFilter.value : "";

    const filtered = properties.filter(property => {
        const searchableText =
            `${property.title} ${property.location} ${property.type} ${property.purpose} ${property.description}`.toLowerCase();

        let matchesBedrooms = true;
        if (bedrooms) {
            matchesBedrooms = property.beds && Number(property.beds) >= Number(bedrooms);
        }

        let matchesAvailability = true;
        if (availability) {
            const propStatus = property.status || "available";
            matchesAvailability = propStatus === availability;
        }

        let matchesPrice = true;
        if (priceRange) {
            const digits = Number(String(property.price || "").replace(/[^0-9.]/g, ""));
            if (priceRange === "0-1000") matchesPrice = digits > 0 && digits <= 1000;
            else if (priceRange === "1000-3000") matchesPrice = digits >= 1000 && digits <= 3000;
            else if (priceRange === "3000-5000") matchesPrice = digits >= 3000 && digits <= 5000;
            else if (priceRange === "5000+") matchesPrice = digits >= 5000;
        }

        return (
            (!search || searchableText.includes(search)) &&
            (!purpose || property.purpose === purpose) &&
            (!type || property.type === type) &&
            (!location || property.location.toLowerCase().includes(location)) &&
            matchesBedrooms &&
            matchesAvailability &&
            matchesPrice
        );
    });

    const hasFilters = search || purpose || type || location || bedrooms || availability || priceRange;
    resultsTitle.textContent = hasFilters ? "Filtered Properties" : "All Properties";
    renderProperties(filtered);
}

function clearAllFilters() {
    searchInput.value = "";
    purposeFilter.value = "";
    typeFilter.value = "";
    locationFilter.value = "";
    if (bedroomsFilter) bedroomsFilter.value = "";
    if (availabilityFilter) availabilityFilter.value = "";
    if (priceFilter) priceFilter.value = "";
    resultsTitle.textContent = "All Properties";
    renderProperties(properties);
}

document.getElementById("applyFilters").addEventListener("click", filterProperties);
document.getElementById("clearFilters").addEventListener("click", clearAllFilters);
searchInput.addEventListener("input", filterProperties);
locationFilter.addEventListener("input", filterProperties);
purposeFilter.addEventListener("change", filterProperties);
typeFilter.addEventListener("change", filterProperties);
if (bedroomsFilter) bedroomsFilter.addEventListener("change", filterProperties);
if (availabilityFilter) availabilityFilter.addEventListener("change", filterProperties);
if (priceFilter) priceFilter.addEventListener("change", filterProperties);

[searchInput, locationFilter].forEach(input => {
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            filterProperties();
        }
    });
});

/* =====================================
   PRESET FILTERS FROM THE LINK
   Example: properties.html?purpose=rent&type=apartment&location=lumley
===================================== */
function presetSelect(select, wanted) {
    if (!wanted || !select) return;
    const match = [...select.options].find(
        option => option.value.toLowerCase() === wanted.toLowerCase()
    );
    if (match) select.value = match.value;
}

const params = new URLSearchParams(window.location.search);
presetSelect(purposeFilter, params.get("purpose"));
presetSelect(typeFilter, params.get("type"));
presetSelect(bedroomsFilter, params.get("beds"));
presetSelect(availabilityFilter, params.get("status"));
locationFilter.value = (params.get("location") || "").slice(0, 100);
searchInput.value = (params.get("q") || "").slice(0, 100);

/* =====================================
   INITIAL LOAD
===================================== */
drawIcons();
filterProperties();
