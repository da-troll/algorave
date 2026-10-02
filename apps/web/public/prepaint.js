// Pre-paint: set the persisted theme before first paint (no flash). External
// file because the CSP allows no inline script.
(function () {
  try {
    var d = document.documentElement;
    var t = localStorage.getItem("app-theme");
    if (t === "dark" || t === "light") d.setAttribute("data-theme", t);
    var f = localStorage.getItem("app-flavor");
    if (f === "mocha" || f === "macchiato" || f === "frappe") d.setAttribute("data-flavor", f);
    var a = localStorage.getItem("app-accent");
    if (a && /^[a-z]+$/.test(a)) d.setAttribute("data-accent", a);
  } catch (e) {}
})();
