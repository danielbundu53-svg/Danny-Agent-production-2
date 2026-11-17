/* =========================================================
   DANNY ANGEL - PROPERTY DATA
   Listings are grouped by section. To add a listing, copy
   an existing one into the right section and give it a new
   unique id. Optional: status: "sold" / "rented" / "under offer" tells the
   chat assistant a listing is no longer available. The pages read the combined "properties" list
   at the bottom of this file, so nothing else needs editing.
   ========================================================= */


/* =========================================================
   SECTION 1: HOUSES FOR SALE
   type: "House"  |  purpose: "Buy"
   ========================================================= */

const housesForSale = [

    {
        id: 1,
        title: "Modern Family Residence",
        location: "Wilberforce, Freetown",
        type: "House",
        purpose: "Buy",
        price: "$185,000",
        beds: 4,
        baths: 3,
        area: "2,800 sq ft",

        // Main image used by property cards
        image: "images/property-1.jpg",

        // Full property gallery
        images: [
            "images/property-1.jpg",
            "images/property-2.jpg",
            "images/property-3.jpg",
            "images/property-4.jpg"
        ],

        description:
            "A spacious modern family residence designed for comfortable living in a desirable Freetown location. The property offers multiple bedrooms, comfortable living spaces and room for a growing family."
    },

    {
        id: 5,
        title: "Contemporary Family Home",
        location: "Lumley, Freetown",
        type: "House",
        purpose: "Buy",
        price: "$220,000",
        beds: 5,
        baths: 4,
        area: "3,100 sq ft",
        image: "images/property-1.jpg",
        images: [
            "images/property-1.jpg"
        ],
        description:
            "A contemporary family home offering generous living spaces and multiple bedrooms in a desirable residential location."
    },

    {
        id: 9,
        title: "Elegant Waterfront Home",
        location: "Lumley, Freetown",
        type: "House",
        purpose: "Buy",
        price: "$310,000",
        beds: 5,
        baths: 4,
        area: "3,800 sq ft",
        image: "images/property-1.jpg",
        images: [
            "images/property-1.jpg"
        ],
        description:
            "An elegant family residence offering generous space and an attractive coastal location."
    }

];


/* =========================================================
   SECTION 2: APARTMENTS FOR RENT
   type: "Apartment"  |  purpose: "Rent"
   ========================================================= */

const apartmentsForRent = [

    {
        id: 2,
        title: "Luxury City Apartment",
        location: "Hill Station, Freetown",
        type: "Apartment",
        purpose: "Rent",
        price: "$1,200 / month",
        beds: 3,
        baths: 2,
        area: "1,600 sq ft",
        image: "images/property-2.jpg",
        images: [
            "images/property-1.jpg",
            "images/property-2.jpg",
            "images/property-3.jpg",
            "images/property-4.jpg"
        ],
        description:
            "A stylish apartment offering convenient city living with comfortable bedrooms, modern spaces and easy access to surrounding areas."
    },

    {
        id: 6,
        title: "Comfortable City Apartment",
        location: "Congo Cross, Freetown",
        type: "Apartment",
        purpose: "Rent",
        price: "$900 / month",
        beds: 2,
        baths: 2,
        area: "1,300 sq ft",
        image: "images/property-2.jpg",
        images: [
            "images/property-2.jpg"
        ],
        description:
            "A comfortable two-bedroom apartment suitable for professionals, couples or small families."
    }

];


/* =========================================================
   SECTION 3: LAND FOR SALE
   type: "Land"  |  purpose: "Buy"
   ========================================================= */

const landForSale = [

    {
        id: 3,
        title: "Prime Development Land",
        location: "Waterloo, Sierra Leone",
        type: "Land",
        purpose: "Buy",
        price: "$75,000",
        beds: 0,
        baths: 0,
        area: "5,000 sq ft",
        image: "images/property-3.jpg",
        images: [
            "images/property-1.jpg",
            "images/property-2.jpg",
            "images/property-3.jpg",
            "images/property-4.jpg"
        ],
        description:
            "A development opportunity suitable for residential or commercial purposes, subject to property verification and applicable planning requirements."
    },

    {
        id: 7,
        title: "Residential Plot",
        location: "Juba, Freetown",
        type: "Land",
        purpose: "Buy",
        price: "$90,000",
        beds: 0,
        baths: 0,
        area: "4,500 sq ft",
        image: "images/property-3.jpg",
        images: [
            "images/property-3.jpg"
        ],
        description:
            "A residential plot positioned for future development in the Juba area."
    }

];


/* =========================================================
   SECTION 4: COMMERCIAL FOR RENT
   type: "Commercial"  |  purpose: "Rent"
   ========================================================= */

const commercialForRent = [

    {
        id: 4,
        title: "Executive Commercial Space",
        location: "Central Freetown",
        type: "Commercial",
        purpose: "Rent",
        price: "$2,500 / month",
        beds: 0,
        baths: 2,
        area: "3,200 sq ft",
        image: "images/property-4.jpg",
        images: [
            "images/property-1.jpg",
            "images/property-2.jpg",
            "images/property-3.jpg",
            "images/property-4.jpg"
        ],
        description:
            "A spacious commercial property suitable for offices, retail operations or professional business activities."
    },

    {
        id: 8,
        title: "Premium Office Building",
        location: "Aberdeen, Freetown",
        type: "Commercial",
        purpose: "Rent",
        price: "$3,200 / month",
        beds: 0,
        baths: 3,
        area: "4,000 sq ft",
        image: "images/property-4.jpg",
        images: [
            "images/property-4.jpg"
        ],
        description:
            "A premium commercial space suited for established companies, organizations and professional services."
    }

];


/* =========================================================
   COMBINED LIST (used by every page - do not remove)
   Sorted by id so the order on the website stays the same
   no matter which section a listing sits in.
   ========================================================= */

const properties = [
    ...housesForSale,
    ...apartmentsForRent,
    ...landForSale,
    ...commercialForRent
].sort((a, b) => a.id - b.id);


/* =========================================================
   SECTIONS SHOWN ON THE PROPERTIES PAGE
   Each section lists everything of one kind together.
   To rename a section or change the order, edit this list.
   The "list" must be one of the four section lists above.
   ========================================================= */

const propertySections = [
    {
        key: "apartments-for-rent",
        title: "Apartments for Rent",
        blurb: "Apartments available to rent.",
        list: apartmentsForRent
    },
    {
        key: "houses-for-sale",
        title: "Houses for Sale",
        blurb: "Family homes and houses you can buy.",
        list: housesForSale
    },
    {
        key: "offices-for-rent",
        title: "Commercial Offices for Rent",
        blurb: "Offices and commercial spaces to rent for your business.",
        list: commercialForRent
    },
    {
        key: "land-for-sale",
        title: "Land for Sale",
        blurb: "Plots of land you can buy.",
        list: landForSale
    }
];


/* Safety check: warns in the browser console if two listings share an id. */
(function checkPropertyIds() {
    const seen = new Set();
    properties.forEach(item => {
        if (seen.has(item.id)) {
            console.warn("properties.js: duplicate property id " + item.id);
        }
        seen.add(item.id);
    });
})();
