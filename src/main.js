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

function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const offer = publicPriceLabel(p);
  const text = `Hola, me interesa: ${p.name} (${offer})`;
  const links = phones.filter((x) => x.phone);
  modal.classList.add("open");
  modal.innerHTML = `
    <div class="sheet">
      <div class="kicker">${p.categoryName}</div>
      <h2>${escapeHtml(p.name)}</h2>
      <p>${escapeHtml(p.description || "Sin descripción")}</p>
      <p class="price">${offer}</p>
      <p class="stock ${p.available ? "" : "out"}">${availabilityLabel(p)}</p>
      ${
        links.length
          ? `<div class="wa-list">${links
              .map((x) => `<a class="btn" target="_blank" rel="noreferrer" href="${whatsappLink(x.phone, text)}">WhatsApp ${escapeHtml(x.label)}</a>`)
              .join("")}</div>`
          : `<p class="empty">WhatsApp aún no configurado.</p>`
      }
      <p><button class="ghost" type="button" id="close-modal">Cerrar</button></p>
    </div>`;
  document.getElementById("close-modal").onclick = () => modal.classList.remove("open");
}

modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.remove("open");
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

boot();
