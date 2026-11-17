const FEATURED_COUNT = 6;

drawIcons();

/* -----------------------------
   Property cards
----------------------------- */
const propertyGrid = document.getElementById("propertyGrid");

function renderProperties(propertyList) {
    if (propertyList.length === 0) {
        propertyGrid.innerHTML = `
            <div class="col-span-full text-center py-14">
                <i data-lucide="search-x" class="w-12 h-12 mx-auto text-gray-300"></i>
                <h3 class="text-xl font-bold text-navy mt-4">No properties found</h3>
                <p class="text-gray-500 mt-2">Try changing your search criteria.</p>
                <a href="properties.html" class="inline-block mt-5 text-sm font-bold text-gold hover:text-navy transition">View all properties</a>
            </div>
        `;
        drawIcons();
        return;
    }

    const favorites = getFavorites();

    propertyGrid.innerHTML = propertyList.map(property => {
        const saved = favorites.includes(property.id);
        const detailUrl = `property-detail.html?id=${encodeURIComponent(property.id)}`;

        return `
            <article class="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition group">
                <div class="h-56 relative overflow-hidden bg-gray-100">
                    <a href="${detailUrl}" aria-label="View ${esc(property.title)}">
                        <img
                            src="${esc(photoUrl(property.image, 800))}"
                            srcset="${esc(photoSrcset(property.image))}"
                            sizes="(min-width: 1024px) 400px, (min-width: 768px) 45vw, 100vw"
                            alt="${esc(property.title)}"
                            class="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                        >
                    </a>
                    <span class="absolute top-4 left-4 bg-white text-navy text-xs font-bold px-3 py-1.5 rounded-full">
                        ${esc(property.purpose)}
                    </span>
                    <button
                        type="button"
                        data-fav="${property.id}"
                        class="absolute top-4 right-4 w-10 h-10 bg-white/90 rounded-full flex items-center justify-center hover:text-red-500 ${saved ? "text-red-500" : "text-gray-600"}"
                        aria-pressed="${saved}"
                        aria-label="${saved ? "Remove from favorites" : "Add to favorites"}"
                    >
                        <i data-lucide="heart" class="w-5 h-5 ${saved ? "fill-current" : ""}"></i>
                    </button>
                </div>
                <div class="p-6">
                    <p class="text-xs uppercase tracking-wider font-bold text-gold">${esc(property.type)}</p>
                    <h3 class="text-xl font-bold text-navy mt-2">
                        <a href="${detailUrl}" class="hover:text-gold transition">${esc(property.title)}</a>
                    </h3>
                    <div class="flex items-center gap-2 text-gray-500 text-sm mt-3">
                        <i data-lucide="map-pin" class="w-4 h-4"></i>
                        ${esc(property.location)}
                    </div>
                    <div class="flex items-center gap-4 text-sm text-gray-500 mt-4 pt-4 border-t">
                        ${property.beds > 0 ? `<span>${property.beds} Beds</span>` : ""}
                        ${property.baths > 0 ? `<span>${property.baths} Baths</span>` : ""}
                        <span>${esc(property.area)}</span>
                    </div>
                    <div class="flex items-center justify-between mt-5">
                        <p class="text-xl font-bold text-navy">${esc(property.price)}</p>
                        <a href="${detailUrl}" class="text-sm font-bold text-gold hover:text-navy transition">View Details</a>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    drawIcons();
}

/* One listener handles every heart button, including ones drawn later */
propertyGrid.addEventListener("click", event => {
    const button = event.target.closest("[data-fav]");
    if (button) toggleFavorite(Number(button.dataset.fav), button);
});

renderProperties(properties.slice(0, FEATURED_COUNT));

/* -----------------------------
   Search
----------------------------- */
document.getElementById("searchForm").addEventListener("submit", event => {
    event.preventDefault();

    const purpose = document.getElementById("propertyPurpose").value.toLowerCase();
    const type = document.getElementById("propertyType").value.toLowerCase();
    const location = document.getElementById("locationInput").value.toLowerCase().trim();

    const filtered = properties.filter(property =>
        (!purpose || property.purpose.toLowerCase() === purpose) &&
        (!type || property.type.toLowerCase() === type) &&
        (!location || property.location.toLowerCase().includes(location))
    );

    renderProperties(filtered);
    document.getElementById("properties").scrollIntoView({ behavior: "smooth" });
});

/* -----------------------------
   Contact form: sends to the server
----------------------------- */
const contactForm = document.getElementById("contactForm");
const formMessage = document.getElementById("formMessage");

function showFormMessage(text, ok) {
    formMessage.textContent = text;
    formMessage.classList.remove("hidden", "text-green-600", "text-red-600");
    formMessage.classList.add(ok ? "text-green-600" : "text-red-600");
}

contactForm.addEventListener("submit", async event => {
    event.preventDefault();

    const data = {
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        email: document.getElementById("email").value.trim(),
        service: document.getElementById("service").value,
        message: document.getElementById("message").value.trim(),
        website: document.getElementById("website").value
    };

    const phoneDigits = data.phone.replace(/\D/g, "");

    if (data.name.length < 2) return showFormMessage("Please enter your name.", false);
    if (phoneDigits.length < 8 || phoneDigits.length > 15) return showFormMessage("Please enter a valid phone number, for example +232 76 123456.", false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return showFormMessage("Please enter a valid email address.", false);
    if (!data.service) return showFormMessage("Please choose what you are interested in.", false);
    if (data.message.length < 10) return showFormMessage("Please write a little more in your message (at least 10 characters).", false);

    const submitButton = contactForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    try {
        const response = await fetchWithTimeout("/api/inquiries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            const serverError = new Error(result.message || "Your message could not be sent. Please try again.");
            serverError.fromServer = true;
            throw serverError;
        }

        showFormMessage(`Thank you! Your enquiry ${result.inquiryId} has been received. We will contact you soon.`, true);
        contactForm.reset();
    } catch (error) {
        const phone = (typeof siteConfig !== "undefined" && siteConfig.phone) ? siteConfig.phone : "";
        const reason = error.fromServer
            ? error.message
            : "We could not reach the server.";
        showFormMessage(`${reason}${phone ? " You can also call or WhatsApp us on " + phone + "." : ""}`, false);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Send Message";
    }
});
