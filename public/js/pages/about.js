drawIcons();

/* Real number of listings on this site (never a made-up figure) */
const listingCount = document.getElementById("listingCount");
if (listingCount) listingCount.textContent = properties.length;
