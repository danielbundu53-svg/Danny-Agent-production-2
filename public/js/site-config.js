/* =========================================================
   DANNY ANGEL - SITE SETTINGS (edit this file only)
   Change your real business details here once. Every page
   that loads this file updates automatically.
   Leave a value as "" to hide it from the website.
   ========================================================= */

const siteConfig = {

    businessName: "Danny Agent",

    // Phone: write it any way you like for display.
    phone: "+232 76 683667",

    // WhatsApp number: digits only, with country code, no + or spaces.
    // Example: 23276123456
    whatsapp: "23276673667",

    // Add your real email between the quotes, e.g. "name@gmail.com"
    email: "dannyagento1@gmail.com",

    address: "Freetown, Sierra Leone",

    openingHours: "",

    // Full links, for example "https://facebook.com/yourpage". "" hides the icon.
    social: {
        facebook: "",
        instagram: "",
        whatsappChannel: ""
    }
};


/* =========================================================
   Fills the pages. Do not edit below this line.

   Markup used in the HTML pages:
     data-site="phone"            -> sets the text
     data-site-href="phone"       -> sets a tel: link
     data-site-href="email"       -> sets a mailto: link
     data-site-href="whatsapp"    -> sets a wa.me link
     data-site-href="facebook"    -> sets the social link
     data-site-hide-empty="..."   -> hides the element when that value is empty
   ========================================================= */

(function applySiteConfig() {

    function valueFor(key) {
        if (key in siteConfig) return siteConfig[key];
        if (siteConfig.social && key in siteConfig.social) return siteConfig.social[key];
        return "";
    }

    function hrefFor(key) {
        const value = valueFor(key);
        if (!value) return "";
        if (key === "phone") return "tel:" + String(value).replace(/[^\d+]/g, "");
        if (key === "email") return "mailto:" + value;
        if (key === "whatsapp") return "https://wa.me/" + String(value).replace(/\D/g, "");
        return value;
    }

    function run() {
        document.querySelectorAll("[data-site]").forEach(el => {
            el.textContent = valueFor(el.dataset.site);
        });

        document.querySelectorAll("[data-site-href]").forEach(el => {
            const href = hrefFor(el.dataset.siteHref);
            if (href) {
                el.setAttribute("href", href);
            } else {
                el.removeAttribute("href");
            }
        });

        document.querySelectorAll("[data-site-hide-empty]").forEach(el => {
            if (!valueFor(el.dataset.siteHideEmpty)) el.style.display = "none";
        });

        document.querySelectorAll("[data-site-year]").forEach(el => {
            el.textContent = new Date().getFullYear();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
    } else {
        run();
    }
})();
