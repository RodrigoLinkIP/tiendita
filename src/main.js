import { getStore, fictionalCatalog } from "./lib/store.js";
import { publicPriceLabel, availabilityLabel } from "./lib/offer.js";
import { whatsappLink } from "./lib/whatsapp.js";

const store = getStore();
const grid = document.getElementById("grid");
const filters = document.getElementById("filters");
const modal = document.getElementById("modal");

let products = [];
let categories = [];
let phones = [];
let active = "all";

async function boot() {
  try {
    if (store.mode === "local" && !(await store.listAllProducts()).length) {
      await store.loadFixture(fictionalCatalog());
    }
    categories = await store.listCategories();
    products = await store.listPublishedProducts();
    phones = store.getWhatsappPhones ? await store.getWhatsappPhones() : [{ label: "WhatsApp", phone: await store.getWhatsappPhone() }];
    renderFilters();
    renderGrid();
  } catch (err) {
    grid.innerHTML = `<p class="empty">No se pudo cargar el catálogo: ${err.message}</p>`;
  }
}

function renderFilters() {
  const chips = [{ id: "all", name: "Todos" }, ...categories];
  filters.innerHTML = chips
    .map(
      (c) =>
        `<button class="chip ${active === c.id || (c.id !== "all" && active === c.slug) ? "active" : ""}" data-id="${c.id}">${c.name}</button>`,
    )
    .join("");
  filters.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      active = btn.dataset.id;
      renderFilters();
      renderGrid();
    });
  });
}

function visible() {
  if (active === "all") return products;
  return products.filter((p) => p.categoryId === active || p.categoryName.toLowerCase() === active);
}

function renderGrid() {
  const list = visible();
  if (!list.length) {
    grid.innerHTML = `<p class="empty">No hay productos publicados en esta categoría.</p>`;
    return;
  }
  grid.innerHTML = list
    .map(
      (p) => `
      <article class="card" data-id="${p.id}">
        <div class="photo">${p.imageUrl ? `<img src="${p.imageUrl}" alt="">` : "Sin foto"}</div>
        <div class="card-body">
          <div class="card-top">
            <div class="kicker">${p.categoryName}</div>
            <h2>${escapeHtml(p.name)}</h2>
          </div>
          <div class="card-foot">
            <div class="price">${publicPriceLabel(p)}</div>
            <div class="stock ${p.available ? "" : "out"}">${availabilityLabel(p)}</div>
            <button data-open="${p.id}">Consultar</button>
          </div>
        </div>
      </article>`,
    )
    .join("");
  grid.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => openProduct(btn.dataset.open));
  });
}

function productUrls(p) {
  const urls = (p.images || []).map((i) => i.url).filter(Boolean);
  if (!urls.length && p.imageUrl) urls.push(p.imageUrl);
  return urls;
}

function galleryHtml(p) {
  const urls = productUrls(p);
  if (!urls.length) return `<div class="carousel-frame muted">Sin foto</div>`;
  if (urls.length === 1) {
    return `<div class="carousel-frame"><img src="${escapeHtml(urls[0])}" alt="${escapeHtml(p.name)}"></div>`;
  }
  return `<div class="carousel" data-count="${urls.length}">
    <div class="carousel-frame" id="slides">
      ${urls
        .map(
          (url, i) =>
            `<img class="${i === 0 ? "on" : ""}" src="${escapeHtml(url)}" alt="${escapeHtml(p.name)} ${i + 1}">`,
        )
        .join("")}
    </div>
    <button type="button" class="carousel-btn prev" id="prev" aria-label="Anterior">‹</button>
    <button type="button" class="carousel-btn next" id="next" aria-label="Siguiente">›</button>
    <div class="dots">${urls.map((_, i) => `<span class="${i === 0 ? "on" : ""}" data-i="${i}"></span>`).join("")}</div>
  </div>`;
}

let carouselTimer;

function stopCarousel() {
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }
}

function bindCarousel(urls) {
  stopCarousel();
  if (urls.length < 2) return;
  let i = 0;
  const slides = [...document.querySelectorAll("#slides img")];
  const dots = [...document.querySelectorAll(".dots span")];
  const show = (n) => {
    i = (n + urls.length) % urls.length;
    slides.forEach((img, idx) => img.classList.toggle("on", idx === i));
    dots.forEach((d, idx) => d.classList.toggle("on", idx === i));
  };
  const play = () => {
    stopCarousel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    carouselTimer = setInterval(() => show(i + 1), 3800);
  };
  document.getElementById("prev").onclick = () => {
    show(i - 1);
    play();
  };
  document.getElementById("next").onclick = () => {
    show(i + 1);
    play();
  };
  dots.forEach((d) => {
    d.onclick = () => {
      show(Number(d.dataset.i));
      play();
    };
  });
  const root = document.querySelector(".carousel");
  root.addEventListener("mouseenter", stopCarousel);
  root.addEventListener("mouseleave", play);
  play();
}

function closeProduct() {
  stopCarousel();
  modal.classList.remove("open");
  modal.innerHTML = "";
}

function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const offer = publicPriceLabel(p);
  const text = `Hola, me interesa: ${p.name} (${offer})`;
  const links = phones.filter((x) => x.phone);
  const urls = productUrls(p);
  modal.classList.add("open");
  modal.innerHTML = `
    <div class="sheet product-sheet">
      ${galleryHtml(p)}
      <div class="product-copy">
        <div class="kicker">${escapeHtml(p.categoryName)}</div>
        <h2>${escapeHtml(p.name)}</h2>
        <p class="lead">${escapeHtml(p.description || "Sin descripción")}</p>
        <p class="price">${offer}</p>
        <p class="stock ${p.available ? "" : "out"}">${availabilityLabel(p)}</p>
      </div>
      <div class="product-cta">
        ${
          links.length
            ? `<p class="kicker">Escribir por WhatsApp</p><div class="wa-list">${links
                .map((x) => `<a class="btn" target="_blank" rel="noreferrer" href="${whatsappLink(x.phone, text)}">${escapeHtml(x.label)}</a>`)
                .join("")}</div>`
            : `<p class="empty">WhatsApp aún no configurado.</p>`
        }
        <button class="ghost close-product" type="button" id="close-modal">Cerrar</button>
      </div>
    </div>`;
  bindCarousel(urls);
  document.getElementById("close-modal").onclick = closeProduct;
}

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeProduct();
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

boot();
