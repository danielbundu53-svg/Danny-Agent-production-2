/* =====================================
   FIND THE PROPERTY FROM THE LINK
   Example: property-detail.html?id=3
===================================== */
const requestedId = Number(new URLSearchParams(window.location.search).get("id"));
const property = properties.find(item => item.id === requestedId);

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

if (!property) {
    /* Unknown or missing id: say so instead of showing the wrong property */
    document.getElementById("propertyContent").remove();
    document.getElementById("notFound").classList.remove("hidden");
    document.title = "Property not found | " + siteConfig.businessName;
    drawIcons();
} else {
    document.getElementById("notFound").remove();
    showProperty(property);
}

function showProperty(property) {
    const images = property.images && property.images.length ? property.images : [property.image];
    document.getElementById("propertyContent").classList.remove("hidden");
    const forSale = property.purpose === "Buy";
    const purposeLabel = forSale ? "For Sale" : "For Rent";

    /* ---------- Page title and search-engine text ---------- */
    document.title = `${property.title} | ${siteConfig.businessName}`;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
        metaDescription.content =
            `${purposeLabel}: ${property.type} in ${property.location}. ${property.price}. ${property.description}`.slice(0, 200);
    }

    /* ---------- Text on the page ---------- */
    setText("propertyTitle", property.title);
    setText("breadcrumbTitle", property.title);
    setText("propertyType", property.type);
    setText("propertyLocation", property.location);
    setText("summaryArea", property.area);
    setText("summaryPurpose", purposeLabel);
    setText("propertyPrice", property.price);
    setText("propertyDescription", property.description);
    setText("purposeBadge", purposeLabel);
    setText("infoType", property.type);
    setText("infoPurpose", property.purpose);
    setText("infoLocation", property.location);
    setText("infoArea", property.area);

    const statusBadgeEl = document.getElementById("statusBadge");
    if (statusBadgeEl) {
        if (property.status === "under_offer") {
            statusBadgeEl.textContent = "Under Offer";
            statusBadgeEl.className = "bg-amber-600 text-white px-4 py-2 rounded-full text-sm font-bold shadow";
        } else if (property.status === "sold") {
            statusBadgeEl.textContent = "Sold";
            statusBadgeEl.className = "bg-red-600 text-white px-4 py-2 rounded-full text-sm font-bold shadow";
        } else if (property.status === "rented") {
            statusBadgeEl.textContent = "Rented";
            statusBadgeEl.className = "bg-slate-700 text-white px-4 py-2 rounded-full text-sm font-bold shadow";
        } else {
            statusBadgeEl.className = "hidden";
        }
    }

    /* ---------- Enquiry buttons ---------- */
    const enquiryUrl = `contact.html?property=${encodeURIComponent(property.id)}`;
    document.getElementById("propertyEnquiryButton").href = enquiryUrl;
    document.getElementById("propertyCtaEnquiry").href = enquiryUrl;

    /* WhatsApp opens with a message that names this property */
    const whatsappButton = document.getElementById("propertyWhatsApp");
    const whatsappNumber = String(siteConfig.whatsapp || "").replace(/\D/g, "");
    if (whatsappNumber) {
        const message =
            `Hello, I am interested in "${property.title}" (${property.location}), ${property.price}. ${window.location.href}`;
        whatsappButton.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
    } else {
        whatsappButton.classList.add("hidden");
    }

    /* ---------- Features ---------- */
    const featureCard = (icon, value, label, valueClass) => `
        <div class="bg-gray-50 rounded-xl p-5 text-center">
            <i data-lucide="${icon}" class="w-6 h-6 mx-auto text-gold"></i>
            <p class="font-bold text-navy ${valueClass} mt-2">${esc(value)}</p>
            <p class="text-sm text-gray-500">${label}</p>
        </div>
    `;

    document.getElementById("propertyFeatures").innerHTML =
        (property.beds ? featureCard("bed-double", property.beds, "Bedrooms", "text-xl") : "") +
        (property.baths ? featureCard("bath", property.baths, "Bathrooms", "text-xl") : "") +
        featureCard("ruler", property.area, "Property Area", "text-sm");

    /* ---------- Gallery ---------- */
    const mainImage = document.getElementById("mainPropertyImage");
    const thumbnailContainer = document.getElementById("thumbnailContainer");
    const imageCounter = document.getElementById("imageCounter");
    const previousButton = document.getElementById("previousImage");
    const nextButton = document.getElementById("nextImage");
    const galleryModal = document.getElementById("galleryModal");
    const galleryModalImage = document.getElementById("galleryModalImage");
    const galleryModalCounter = document.getElementById("galleryModalCounter");
    let currentIndex = 0;
    let lastFocused = null;

    function showImage(index) {
        currentIndex = (index + images.length) % images.length;
        mainImage.removeAttribute("data-failed");
        mainImage.sizes = "(min-width: 1024px) 900px, 100vw";
        mainImage.srcset = photoSrcset(images[currentIndex]);
        mainImage.src = photoUrl(images[currentIndex], 1200);
        mainImage.alt = `${property.title}, photo ${currentIndex + 1} of ${images.length}`;
        imageCounter.textContent = `${currentIndex + 1} / ${images.length}`;

        thumbnailContainer.querySelectorAll("[data-thumb]").forEach(thumb => {
            const active = Number(thumb.dataset.thumb) === currentIndex;
            thumb.classList.toggle("ring-2", active);
            thumb.classList.toggle("ring-gold", active);
            thumb.setAttribute("aria-current", String(active));
        });

        if (!galleryModal.classList.contains("hidden")) {
            showModalPhoto();
            galleryModalCounter.textContent = `${currentIndex + 1} / ${images.length}`;
        }
    }

    function showModalPhoto() {
        galleryModalImage.removeAttribute("data-failed");
        galleryModalImage.sizes = "90vw";
        galleryModalImage.srcset = photoSrcset(images[currentIndex]);
        galleryModalImage.src = photoUrl(images[currentIndex], 1200);
        galleryModalImage.alt = `${property.title}, photo ${currentIndex + 1} of ${images.length}`;
    }

    if (images.length > 1) {
        thumbnailContainer.innerHTML = images.map((image, index) => `
            <button
                type="button"
                data-thumb="${index}"
                class="h-20 md:h-24 rounded-xl overflow-hidden bg-gray-200 border-2 border-transparent"
                aria-label="View photo ${index + 1}"
            >
                <img src="${esc(photoUrl(image, 480))}" alt="" loading="lazy" decoding="async" class="w-full h-full object-cover">
            </button>
        `).join("");

        thumbnailContainer.addEventListener("click", event => {
            const thumb = event.target.closest("[data-thumb]");
            if (thumb) showImage(Number(thumb.dataset.thumb));
        });

        previousButton.addEventListener("click", () => showImage(currentIndex - 1));
        nextButton.addEventListener("click", () => showImage(currentIndex + 1));
        document.getElementById("galleryPrev").addEventListener("click", () => showImage(currentIndex - 1));
        document.getElementById("galleryNext").addEventListener("click", () => showImage(currentIndex + 1));
    } else {
        /* One photo only: no arrows, counter or thumbnails */
        [previousButton, nextButton, imageCounter, thumbnailContainer,
            document.getElementById("galleryPrev"), document.getElementById("galleryNext"),
            galleryModalCounter].forEach(el => el.classList.add("hidden"));
    }

    function openGallery() {
        lastFocused = document.activeElement;
        galleryModal.classList.remove("hidden");
        document.body.classList.add("overflow-hidden");
        showModalPhoto();
        galleryModalCounter.textContent = `${currentIndex + 1} / ${images.length}`;
        document.getElementById("closeGallery").focus();
    }

    function closeGallery() {
        galleryModal.classList.add("hidden");
        document.body.classList.remove("overflow-hidden");
        if (lastFocused) lastFocused.focus();
    }

    mainImage.addEventListener("click", openGallery);
    document.getElementById("closeGallery").addEventListener("click", closeGallery);
    galleryModal.addEventListener("click", event => {
        if (event.target === galleryModal) closeGallery();
    });

    document.addEventListener("keydown", event => {
        if (galleryModal.classList.contains("hidden")) return;
        if (event.key === "Escape") closeGallery();
        if (images.length > 1 && event.key === "ArrowLeft") showImage(currentIndex - 1);
        if (images.length > 1 && event.key === "ArrowRight") showImage(currentIndex + 1);
    });

    showImage(0);

    /* ---------- Favorite ---------- */
    const favoriteButton = document.getElementById("favoriteButton");

    drawIcons();

    if (isFavorite(property.id)) {
        favoriteButton.classList.add("text-red-500");
        favoriteButton.setAttribute("aria-pressed", "true");
        favoriteButton.setAttribute("aria-label", "Remove from favorites");
        const icon = favoriteButton.querySelector("svg");
        if (icon) icon.classList.add("fill-current");
    } else {
        favoriteButton.setAttribute("aria-pressed", "false");
        favoriteButton.setAttribute("aria-label", "Add to favorites");
    }

    favoriteButton.addEventListener("click", () => toggleFavorite(property.id, favoriteButton));
}
