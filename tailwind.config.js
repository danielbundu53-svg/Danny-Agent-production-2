/** Tailwind build settings: same colours the pages used before. */
module.exports = {
  content: ["./public/**/*.html", "./public/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        navy: "#123B63",
        darknavy: "#0B2945",
        gold: "#D4A84F",
        lightgold: "#F4E7C4"
      }
    }
  }
};
