drawIcons();

/* =====================================
   PROPERTY ENQUIRY PREFILL
   Example: contact.html?property=3
===================================== */
const selectedPropertyId = Number(new URLSearchParams(window.location.search).get("property"));
const selectedProperty = properties.find(item => item.id === selectedPropertyId);

const serviceSelect = document.getElementById("service");
const messageField = document.getElementById("message");

function applyPropertyPrefill() {
    if (!selectedProperty) return;

    document.getElementById("selectedPropertyCard").classList.remove("hidden");
    document.getElementById("selectedPropertyTitle").textContent = selectedProperty.title;
    document.getElementById("selectedPropertyLocation").textContent = selectedProperty.location;
    document.getElementById("selectedPropertyPrice").textContent = selectedProperty.price;

    document.getElementById("propertyId").value = selectedProperty.id;
    document.getElementById("propertyTitle").value = selectedProperty.title;
    document.getElementById("propertyLocation").value = selectedProperty.location;

    serviceSelect.value = selectedProperty.purpose === "Rent" ? "rent" : "buy";
}

applyPropertyPrefill();

if (selectedProperty && !messageField.value) {
    messageField.value =
        `I am interested in "${selectedProperty.title}" in ${selectedProperty.location}. Please contact me with more details.`;
}

/* =====================================
   CONTACT FORM
===================================== */
const contactForm = document.getElementById("contactForm");
const formMessage = document.getElementById("formMessage");
const SERVICES = ["buy", "rent", "sell", "investment", "management", "other"];

const FIELD_ERRORS = {
    name: "nameError",
    phone: "phoneError",
    email: "emailError",
    service: "serviceError",
    message: "messageError"
};

function showFieldError(fieldId, text) {
    const error = document.getElementById(FIELD_ERRORS[fieldId]);
    const field = document.getElementById(fieldId);
    error.textContent = text;
    error.classList.remove("hidden");
    field.setAttribute("aria-invalid", "true");
    field.classList.add("border-red-400");
}

function clearFieldError(fieldId) {
    const error = document.getElementById(FIELD_ERRORS[fieldId]);
    const field = document.getElementById(fieldId);
    error.textContent = "";
    error.classList.add("hidden");
    field.removeAttribute("aria-invalid");
    field.classList.remove("border-red-400");
}

function showFormMessage(text, kind) {
    const styles = {
        success: "bg-green-50 text-green-700",
        error: "bg-red-50 text-red-600"
    };
    formMessage.textContent = text;
    formMessage.className = `rounded-lg px-4 py-3 text-sm ${styles[kind]}`;
    formMessage.setAttribute("role", kind === "error" ? "alert" : "status");
}

/* Same rules as the server, so a form that passes here is accepted there */
function validate(values) {
    const errors = {};
    const phoneDigits = values.phone.replace(/\D/g, "");

    if (values.name.length < 2) {
        errors.name = "Please enter your full name.";
    }
    if (!/^\+?[\d\s().-]+$/.test(values.phone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
        errors.phone = "Please enter a valid phone number, for example +232 76 123456.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) {
        errors.email = "Please enter a valid email address.";
    }
    if (!SERVICES.includes(values.service)) {
        errors.service = "Please select what we can help with.";
    }
    if (values.message.length < 10) {
        errors.message = "Please tell us a little more about what you need (at least 10 characters).";
    }
    return errors;
}

Object.keys(FIELD_ERRORS).forEach(fieldId => {
    const field = document.getElementById(fieldId);
    field.addEventListener("input", () => clearFieldError(fieldId));
    field.addEventListener("change", () => clearFieldError(fieldId));
});

contactForm.addEventListener("submit", async event => {
    event.preventDefault();

    Object.keys(FIELD_ERRORS).forEach(clearFieldError);
    formMessage.classList.add("hidden");

    const budgetSelect = document.getElementById("budget");

    const enquiry = {
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        email: document.getElementById("email").value.trim(),
        service: serviceSelect.value,
        /* Save the readable text (for example "Under $50,000"), not the code */
        budget: budgetSelect.value ? budgetSelect.selectedOptions[0].textContent.trim() : "",
        location: document.getElementById("location").value.trim(),
        message: messageField.value.trim(),
        propertyId: document.getElementById("propertyId").value || null,
        propertyTitle: document.getElementById("propertyTitle").value || null,
        propertyLocation: document.getElementById("propertyLocation").value || null,
        website: document.getElementById("website").value
    };

    const errors = validate(enquiry);
    const failedFields = Object.keys(errors);

    if (failedFields.length) {
        failedFields.forEach(fieldId => showFieldError(fieldId, errors[fieldId]));
        showFormMessage("Please correct the highlighted fields.", "error");
        document.getElementById(failedFields[0]).focus();
        return;
    }

    const submitButton = contactForm.querySelector('button[type="submit"]');
    const buttonLabel = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    try {
        const response = await fetchWithTimeout("/api/inquiries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(enquiry)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            const serverError = new Error(result.message || "Your enquiry could not be sent. Please try again.");
            serverError.fromServer = true;
            throw serverError;
        }

        showFormMessage(
            `Thank you! Your enquiry ${result.inquiryId} has been received. Our property team will contact you soon.`,
            "success"
        );
        contactForm.reset();
        applyPropertyPrefill();   /* keep the chosen property after the form clears */
        formMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
        /* Nothing is saved on the visitor's device: the form keeps what they typed so they can retry. */
        const reason = error.fromServer
            ? error.message
            : "We could not reach the server, so your enquiry was NOT sent.";
        const alternative = siteConfig.phone
            ? ` You can also call or WhatsApp us on ${siteConfig.phone}.`
            : "";
        showFormMessage(reason + alternative, "error");
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = buttonLabel;
        drawIcons();
    }
});
