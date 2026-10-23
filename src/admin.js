import { getStore, fictionalCatalog } from "./lib/store.js";
import { money, unitMoney } from "./lib/money.js";
import { impliedUnitPrice, publicPriceLabel, availabilityLabel, unitBuyCost } from "./lib/offer.js";

const store = getStore();
const app = document.getElementById("app");
const today = () => new Date().toISOString().slice(0, 10);
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const routes = {
  "#/productos": renderProducts,
  "#/compras": renderPurchases,
  "#/ventas": renderSales,
  "#/gastos": renderExpenses,
  "#/capital": renderCapital,
  "#/kardex": renderKardex,
  "#/resumen": renderReport,
  "#/ajustes": renderSettings,
};

async function boot() {
  window.addEventListener("hashchange", render);
  await render();
}

async function render() {
  const session = await store.getSession();
  if (!session) {
    app.innerHTML = loginView();
    bindLogin();
    bindRecoveryIfPresent();
    return;
  }
  if (session.unauthorized) {
    app.innerHTML = `<div class="login"><p>Tu usuario autenticó, pero no está en admin_users.</p><button id="out">Salir</button></div>`;
    document.getElementById("out").onclick = async () => {
      await store.signOut();
      render();
    };
    return;
  }
  const hash = routes[location.hash] ? location.hash : "#/productos";
  if (location.hash !== hash) location.hash = hash;
  app.innerHTML = shell(session, hash);
  document.getElementById("logout").onclick = async () => {
    await store.signOut();
    render();
  };
  try {
    await routes[hash](document.getElementById("view"));
  } catch (err) {
    document.getElementById("view").innerHTML = `<p class="banner">${esc(err.message)}</p>`;
  }
}

function loginView() {
  const localHint =
    store.mode === "local"
      ? `<p class="empty">Modo local: usa vero@local.test, rodri@local.test o sofi@local.test. La contraseña se ignora.</p>`
      : `<p class="empty">Ingresa con el correo autorizado. Puedes cambiar la contraseña después, en Ajustes.</p>`;
  return `<form class="login stack" id="login">
    <h1>Panel VRS Store</h1>
    ${localHint}
    <label>Correo <input name="email" type="email" required></label>
    <label>Contraseña <input name="password" type="password"></label>
    <button type="submit">Entrar</button>
    <p id="err" class="empty"></p>
  </form>`;
}

function bindRecoveryIfPresent() {
  if (!store.updatePassword) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("type") !== "recovery" && !window.location.hash.includes("type=recovery")) return;
  app.insertAdjacentHTML(
    "afterbegin",
    `<form class="login stack" id="newpass"><h2>Nueva contraseña</h2><label>Contraseña <input name="password" type="password" required minlength="8"></label><button>Guardar</button><p id="perr" class="empty"></p></form>`,
  );
  document.getElementById("newpass").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await store.updatePassword(new FormData(e.target).get("password"));
      location.href = "./admin.html";
    } catch (err) {
      document.getElementById("perr").textContent = err.message;
    }
  };
}

function bindLogin() {
  document.getElementById("login").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await store.signIn(fd.get("email"), fd.get("password"));
      if (store.mode === "local") {
        const products = await store.listAllProducts();
        if (!products.length) await store.loadFixture(fictionalCatalog());
      }
      await render();
    } catch (err) {
      document.getElementById("err").textContent = err.message;
    }
  };
}

function shell(session, hash) {
  const links = [
    ["#/productos", "Productos"],
    ["#/compras", "Compras"],
    ["#/ventas", "Ventas"],
    ["#/gastos", "Gastos"],
    ["#/capital", "Capital"],
    ["#/kardex", "Inventario"],
    ["#/resumen", "Resumen"],
    ["#/ajustes", "Ajustes"],
  ];
  return `<div class="admin-shell">
    <aside class="side">
      <div class="brand">VRS <span>Store</span></div>
      <p>${esc(session.displayName)}</p>
      ${links.map(([href, label]) => `<a class="${hash === href ? "active" : ""}" href="${href}">${label}</a>`).join("")}
      <button class="ghost" id="logout" type="button">Salir</button>
    </aside>
    <main class="main"><div id="view"></div></main>
    <div id="modal" class="modal" role="dialog" aria-modal="true"></div>
  </div>`;
}

function closeSheet() {
  const m = document.getElementById("modal");
  if (!m) return;
  m.classList.remove("open");
  m.innerHTML = "";
}

function openSheet(html) {
  const m = document.getElementById("modal");
  m.classList.add("open");
  m.innerHTML = `<div class="sheet">${html}<div class="toolbar"><button type="button" class="ghost" id="close-modal">Cerrar</button></div></div>`;
  m.querySelector("#close-modal").onclick = closeSheet;
  m.onclick = (e) => {
    if (e.target === m) closeSheet();
  };
}

async function afterSave() {
  closeSheet();
  await render();
}

function lockSubmit(form, label = "Guardando…") {
  if (form.dataset.busy === "1") return null;
  form.dataset.busy = "1";
  const buttons = [...form.querySelectorAll("button[type=submit], button:not([type])")];
  const original = buttons.map((b) => ({ text: b.textContent, disabled: b.disabled }));
  buttons.forEach((b) => {
    b.disabled = true;
    b.textContent = label;
  });
  return () => {
    form.dataset.busy = "";
    buttons.forEach((b, i) => {
      b.disabled = original[i].disabled;
      b.textContent = original[i].text;
    });
  };
}

async function renderReport(el) {
  const r = await store.report();
  el.innerHTML = `
    <h1>Resumen financiero (USD)</h1>
    <div class="kpis">
      ${kpi("Capital aportado", r.capital)}
      ${kpi("Mercadería comprada", r.merchandisePurchased)}
      ${kpi("Capital menos compras", r.remainingCapitalAfterPurchases)}
      ${kpi("Costo de mercadería vendida (COGS)", r.cogs)}
      ${kpi("Valor de inventario restante", r.inventoryValue)}
      ${kpi("Ingresos por ventas confirmadas", r.salesRevenue)}
      ${kpi("Ganancia bruta (ingresos − COGS)", r.grossProfit)}
      ${kpi("Gastos operativos", r.operatingExpenses)}
      ${kpi("Resultado (bruta − gastos)", r.operatingResult)}
      ${kpi("Efectivo estimado (contado)", r.estimatedCash)}
      <div class="kpi note">La ganancia no es ventas menos compras. Las compras dejan inventario; la ganancia bruta usa solo lo vendido.</div>
    </div>`;
}

function kpi(label, value) {
  return `<div class="kpi"><span>${label}</span><b>${money(value)}</b></div>`;
}

function productForm(categories, p = {}) {
  const pack = p.sellMode === "pack";
  return `<form id="pform" class="stack">
    <input type="hidden" name="id" value="${esc(p.id || "")}">
    <label>Nombre <input name="name" required value="${esc(p.name || "")}"></label>
    <label>Descripción <textarea name="description">${esc(p.description || "")}</textarea></label>
    <label>Categoría <select name="categoryId">${categories
      .map((c) => `<option value="${esc(c.id)}" ${p.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`)
      .join("")}</select></label>
    <label>Cómo se vende
      <select name="sellMode">
        <option value="pack" ${pack ? "selected" : ""}>Por paquete (ej. 2 por 0.25)</option>
        <option value="unit" ${pack ? "" : "selected"}>Por unidad</option>
      </select>
    </label>
    <label class="pack-only">Unidades por paquete <input name="packQty" type="number" min="2" step="1" value="${esc(p.packQty || 2)}"></label>
    <label class="pack-only">Precio del paquete <input name="packPrice" type="number" min="0" step="0.0001" value="${esc(p.packPrice || "")}"></label>
    <label class="unit-only">Precio por unidad <input name="unitSalePrice" type="number" min="0" step="0.0001" value="${esc(p.unitSalePrice ?? "")}"></label>
    <label>Disponibilidad en el catálogo
      <select name="availabilityDisplay">
        <option value="subject" ${p.availabilityDisplay === "subject" ? "selected" : ""}>Sujeto a disponibilidad</option>
        <option value="count" ${p.availabilityDisplay !== "subject" ? "selected" : ""}>Mostrar cuántos quedan</option>
      </select>
    </label>
    ${(p.images || []).length ? `<div class="thumbs">${(p.images || []).map((img) => `<figure><img src="${esc(img.url)}" alt=""><button type="button" class="ghost del-img" data-id="${esc(img.id)}">×</button></figure>`).join("")}</div>` : ""}
    <label>Fotos <input name="imageFiles" type="file" accept="image/*" multiple></label>
    <label class="check"><input type="checkbox" name="isPublished" ${p.isPublished ? "checked" : ""}> Mostrar en el catálogo público</label>
    <button type="submit">${p.id ? "Guardar cambios" : "Crear producto"}</button>
    <p id="ferr" class="banner" hidden></p>
  </form>`;
}

function toggleSellFields(root = document) {
  const mode = root.querySelector("[name=sellMode]")?.value;
  root.querySelectorAll(".pack-only").forEach((el) => {
    const on = mode === "pack";
    el.hidden = !on;
    el.querySelectorAll("input, select, textarea").forEach((i) => {
      i.disabled = !on;
      if (i.name === "packQty") {
        i.min = on ? "2" : "1";
        i.removeAttribute("required");
      }
    });
  });
  root.querySelectorAll(".unit-only").forEach((el) => {
    const on = mode === "unit";
    el.hidden = !on;
    el.querySelectorAll("input, select, textarea").forEach((i) => {
      i.disabled = !on;
    });
  });
}

function productPayload(fd) {
  return {
    id: fd.get("id") || undefined,
    name: fd.get("name"),
    description: fd.get("description"),
    categoryId: fd.get("categoryId"),
    sellMode: fd.get("sellMode"),
    packQty: fd.get("packQty"),
    packPrice: fd.get("packPrice"),
    unitSalePrice: fd.get("unitSalePrice"),
    availabilityDisplay: fd.get("availabilityDisplay"),
    imageFiles: [...(document.querySelector("#pform [name=imageFiles]")?.files || [])],
    isPublished: fd.get("isPublished") === "on",
  };
}

function bindProductForm(categoriesLookup) {
  toggleSellFields();
  document.querySelector("#pform [name=sellMode]")?.addEventListener("change", () => toggleSellFields());
  document.getElementById("pform").onsubmit = async (e) => {
    e.preventDefault();
    const unlock = lockSubmit(e.target);
    if (!unlock) return;
    const fd = new FormData(e.target);
    const errBox = document.getElementById("ferr");
    try {
      await store.saveProduct(productPayload(fd));
      await afterSave();
    } catch (err) {
      unlock();
      errBox.hidden = false;
      errBox.textContent = err.message;
    }
  };
  document.querySelectorAll(".del-img").forEach((btn) => {
    btn.onclick = async () => {
      if (!store.removeProductImage) return;
      try {
        await store.removeProductImage(btn.dataset.id);
        btn.closest("figure")?.remove();
      } catch (err) {
        document.getElementById("ferr").hidden = false;
        document.getElementById("ferr").textContent = err.message;
      }
    };
  });
  void categoriesLookup;
}

function matchesQuery(text, q) {
  if (!q) return true;
  return String(text || "")
    .toLowerCase()
    .includes(q.toLowerCase().trim());
}

async function renderProducts(el) {
  const [products, categories] = await Promise.all([store.listAllProducts(), store.listCategories()]);
  const live = products.filter((p) => !p.archivedAt);
  el.innerHTML = `
    <h1>Productos</h1>
    <p class="empty">Catálogo público: nombre, cómo se vende, fotos y publicación. El stock y Temu están en Compras.</p>
    <div class="toolbar">
      <button type="button" id="new-p">Nuevo producto</button>
      <button type="button" class="secondary" id="new-sale">Registrar venta</button>
    </div>
    <div class="filters-bar">
      <input type="search" id="p-search" placeholder="Buscar producto..." autocomplete="off">
      <select id="p-cat"><option value="">Todas las categorías</option>${categories
        .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
        .join("")}</select>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Categoría</th><th>Se vende</th><th>Público</th><th></th></tr></thead>
      <tbody id="p-rows"></tbody>
    </table></div>`;

  const openProduct = (id) => {
    const p = products.find((x) => x.id === id) || {};
    openSheet(`<h2>${id ? "Editar producto" : "Nuevo producto"}</h2>${productForm(categories, p)}`);
    bindProductForm();
    toggleSellFields();
    document.querySelector("[name=sellMode]").onchange = () => toggleSellFields();
  };

  const paint = () => {
    const q = el.querySelector("#p-search").value;
    const cat = el.querySelector("#p-cat").value;
    const rows = live.filter((p) => (!cat || p.categoryId === cat) && (matchesQuery(p.name, q) || matchesQuery(p.description, q)));
    const body = el.querySelector("#p-rows");
    body.innerHTML = rows.length
      ? rows
          .map(
            (p) => `<tr class="clickable" data-id="${esc(p.id)}">
                    <td>${esc(p.name)}</td>
                    <td>${esc(p.categoryName || "")}</td>
                    <td>${esc(publicPriceLabel(p))}<br><span class="kicker">${esc(availabilityLabel({ ...p, available: p.stockQty > 0 }))}</span></td>
                    <td>${p.isPublished ? "sí" : "no"}</td>
                    <td class="actions">
                      <button type="button" class="ghost edit" data-id="${esc(p.id)}">Editar</button>
                      <button type="button" class="ghost drop" data-id="${esc(p.id)}">Eliminar</button>
                    </td>
                  </tr>`,
          )
          .join("")
      : `<tr><td colspan="5">Sin productos con ese filtro.</td></tr>`;
    body.querySelectorAll("tr.clickable").forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest("button")) return;
        openProduct(tr.dataset.id);
      };
    });
    body.querySelectorAll("button.edit").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openProduct(btn.dataset.id);
      };
    });
    body.querySelectorAll("button.drop").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("¿Eliminarlo del catálogo y vaciar el stock? No se podrá restockear este mismo renglón; las compras/ventas pasadas quedan en el historial.")) return;
        await store.archiveProduct(btn.dataset.id);
        await render();
      };
    });
  };

  el.querySelector("#new-p").onclick = () => openProduct("");
  el.querySelector("#new-sale").onclick = () => openSaleModal(products);
  el.querySelector("#p-search").oninput = paint;
  el.querySelector("#p-cat").onchange = paint;
  paint();
}

function saleStatusLabel(status) {
  if (status === "reserved") return "Apartada";
  if (status === "cancelled") return "Cancelada";
  if (status === "sold" || status === "confirmed") return "Comprada";
  return status || "";
}

function productPackQty(p) {
  const n = Number(p?.packQty || 0);
  return n > 1 ? n : 2;
}

function openSaleModal(products, sale) {
  const live = products.filter((p) => !p.archivedAt);
  const line = sale?.lines?.[0] || {};
  const current = products.find((x) => x.id === line.productId);
  const options = [...live];
  if (current && !options.some((x) => x.id === current.id)) options.unshift(current);
  const selectedId = line.productId || options[0]?.id || "";
  const status = sale?.status === "confirmed" ? "sold" : sale?.status || "sold";
  const startProduct = options.find((p) => p.id === selectedId) || options[0];
  const packSize = productPackQty(startProduct);
  const qtyNum = Number(line.qty || 0);
  const inferredPack = sale?.id
    ? qtyNum > 1 && qtyNum % packSize === 0
    : startProduct?.sellMode === "pack";
  const packsValue = inferredPack && packSize ? Math.max(1, Math.round((qtyNum || packSize) / packSize)) : 1;
  openSheet(`<h2>${sale?.id ? "Editar venta" : "Registrar venta"}</h2>
    <p class="empty">Elige si esta venta es por paquete o por unidad (por ejemplo un solo sticker). Comprada o apartada descuenta stock; cancelada lo devuelve.</p>
    <form id="sform" class="stack">
      <label>Fecha <input name="soldOn" type="date" value="${esc(sale?.soldOn || today())}" required></label>
      <label>Estado
        <select name="status">
          <option value="sold" ${status === "sold" ? "selected" : ""}>Comprada</option>
          <option value="reserved" ${status === "reserved" ? "selected" : ""}>Apartada</option>
          <option value="cancelled" ${status === "cancelled" ? "selected" : ""}>Cancelada</option>
        </select>
      </label>
      <label>Notas <input name="notes" value="${esc(sale?.notes || "")}"></label>
      <label>Producto <select name="productId">${options
        .map((p) => `<option value="${esc(p.id)}" ${p.id === selectedId ? "selected" : ""}>${esc(p.name)} (${p.stockQty})</option>`)
        .join("")}</select></label>
      <p id="offer-hint" class="empty"></p>
      <div>
        <span class="kicker">Cómo se cobró</span>
        <div class="choice" role="radiogroup" aria-label="Tipo de venta">
          <label class="choice-opt"><input type="radio" name="saleMode" value="pack" ${inferredPack ? "checked" : ""}><span>Por paquete</span></label>
          <label class="choice-opt"><input type="radio" name="saleMode" value="unit" ${inferredPack ? "" : "checked"}><span>Por unidad</span></label>
        </div>
      </div>
      <label class="pack-only">Paquetes <input name="packs" type="number" min="1" step="1" value="${esc(packsValue)}"></label>
      <label class="unit-only">Unidades <input name="qty" type="number" min="1" step="1" value="${esc(line.qty || 1)}"></label>
      <label class="unit-only">Precio cobrado por unidad <input name="unitPrice" type="number" min="0" step="0.0001" required value="${esc(line.unitPrice ?? "")}"></label>
      <button type="submit">${sale?.id ? "Guardar venta" : "Registrar venta"}</button>
      <p id="ferr" class="banner" hidden></p>
    </form>`);
  const form = document.getElementById("sform");
  const saleMode = () => form.querySelector("[name=saleMode]:checked")?.value || "unit";
  const fill = () => {
    const p = options.find((x) => x.id === form.productId.value) || startProduct;
    if (!p) return;
    const mode = saleMode();
    document.getElementById("offer-hint").textContent =
      mode === "pack"
        ? `Paquete del producto: ${publicPriceLabel({ ...p, sellMode: "pack", packQty: productPackQty(p), packPrice: p.packPrice || impliedUnitPrice(p) * productPackQty(p) })}`
        : "Venta por unidad: puedes poner el precio de esta venta.";
    if (mode === "unit" && (!sale?.id || p.id !== line.productId)) {
      form.unitPrice.value = p.unitSalePrice || impliedUnitPrice(p);
    }
    form.querySelectorAll(".pack-only").forEach((el) => {
      const on = mode === "pack";
      el.hidden = !on;
      el.querySelectorAll("input").forEach((i) => {
        i.disabled = !on;
      });
    });
    form.querySelectorAll(".unit-only").forEach((el) => {
      const on = mode === "unit";
      el.hidden = !on;
      el.querySelectorAll("input").forEach((i) => {
        i.disabled = !on;
      });
    });
  };
  form.productId.onchange = fill;
  form.querySelectorAll("[name=saleMode]").forEach((r) => {
    r.onchange = fill;
  });
  fill();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const unlock = lockSubmit(e.target);
    if (!unlock) return;
    const fd = new FormData(e.target);
    const p = products.find((x) => x.id === fd.get("productId"));
    try {
      let qty;
      let unitPrice;
      if (saleMode() === "pack") {
        const packs = Number(fd.get("packs") || 1);
        const size = productPackQty(p);
        qty = packs * size;
        unitPrice = p.sellMode === "pack" ? impliedUnitPrice(p) : Number(p.packPrice || 0) / size || Number(p.unitSalePrice || 0);
      } else {
        qty = fd.get("qty");
        unitPrice = fd.get("unitPrice");
      }
      await store.saveSale({
        id: sale?.id,
        soldOn: fd.get("soldOn"),
        notes: fd.get("notes"),
        status: fd.get("status"),
        lines: [{ productId: fd.get("productId"), qty, unitPrice }],
      });
      await afterSave();
    } catch (err) {
      unlock();
      const box = document.getElementById("ferr");
      box.hidden = false;
      box.textContent = err.message;
    }
  };
}

function temuCell(p) {
  const url = String(p.temuUrl || "").trim();
  if (!url) return `<span class="empty">Sin link</span>`;
  return `<a href="${esc(url)}" target="_blank" rel="noreferrer">Abrir Temu</a>`;
}

function openRestockModal(product = {}) {
  const isNew = !product.id;
  const buy = unitBuyCost(product);
  openSheet(`<h2>${isNew ? "Nuevo producto en stock" : `Editar compra — ${esc(product.name)}`}</h2>
    <p class="empty">El costo por pieza es el precio de un producto en Temu dividido entre las unidades que trae ese producto (no entre cuántos productos hay en stock).</p>
    <form id="rform" class="stack">
      <label>Nombre <input name="name" required value="${esc(product.name || "")}"></label>
      <label>Link de Temu <input name="temuUrl" type="text" value="${esc(product.temuUrl || "")}" placeholder="https://"></label>
      <label>Precio de compra de un producto (Temu) <input name="listPriceRemote" type="number" min="0" step="0.0001" value="${esc(product.listPriceRemote || "")}"></label>
      <label>Unidades que trae cada producto <input name="remotePackQty" type="number" min="1" step="1" value="${esc(product.remotePackQty || 1)}"></label>
      <label>Costo por unidad <input id="unit-buy" type="text" readonly tabindex="-1" value="${buy ? unitMoney(buy) : "—"}"></label>
      <label>Stock actual (piezas) <input name="stockQty" type="number" min="0" step="1" required value="${esc(product.stockQty ?? 0)}"></label>
      <button type="submit">${isNew ? "Agregar al stock" : "Guardar cambios"}</button>
      <p id="ferr" class="banner" hidden></p>
    </form>`);
  const form = document.getElementById("rform");
  const refreshUnit = () => {
    const price = Number(form.listPriceRemote.value);
    const units = Number(form.remotePackQty.value);
    const cost = units > 0 && price > 0 ? price / units : 0;
    document.getElementById("unit-buy").value = cost ? unitMoney(cost) : "—";
  };
  form.listPriceRemote.addEventListener("input", refreshUnit);
  form.remotePackQty.addEventListener("input", refreshUnit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const unlock = lockSubmit(form);
    if (!unlock) return;
    const fd = new FormData(form);
    const price = Number(fd.get("listPriceRemote") || 0);
    const units = Math.max(1, Math.floor(Number(fd.get("remotePackQty") || 1)));
    const qty = Math.max(0, Math.floor(Number(fd.get("stockQty") || 0)));
    const unitCost = units > 0 && price > 0 ? price / units : 0;
    try {
      if (isNew) {
        const created = await store.saveProduct({
          name: fd.get("name"),
          description: "",
          temuUrl: fd.get("temuUrl"),
          listPriceRemote: price,
          remotePackQty: units,
          sellMode: "unit",
          unitSalePrice: 0,
          availabilityDisplay: "subject",
          stockQty: 0,
          avgUnitCost: 0,
          isPublished: false,
        });
        if (qty > 0) {
          const draft = await store.createPurchaseDraft({
            purchasedOn: today(),
            notes: "Alta de producto",
            lines: [{ productId: created.id, qty, unitCost }],
          });
          await store.confirmPurchase(draft.id);
        }
      } else {
        await store.saveProduct({
          ...product,
          name: fd.get("name"),
          temuUrl: fd.get("temuUrl"),
          listPriceRemote: price,
          remotePackQty: units,
          stockQty: qty,
          avgUnitCost: unitCost || product.avgUnitCost,
        });
      }
      await afterSave();
    } catch (err) {
      unlock();
      const box = document.getElementById("ferr");
      box.hidden = false;
      box.textContent = err.message;
    }
  };
}

async function renderPurchases(el) {
  const [products, purchases] = await Promise.all([store.listAllProducts(), store.listPurchases()]);
  const live = products.filter((p) => !p.archivedAt);
  el.innerHTML = `
    <h1>Posibles compras</h1>
    <p class="empty">Entrar stock crea un producto nuevo con los mismos datos de compra. También puedes editar o eliminar cualquiera.</p>
    <div class="toolbar"><button type="button" id="new-buy">Entrar stock</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Producto</th><th>Stock</th><th>Precio compra</th><th>Trae</th><th>Costo/u</th><th>Link</th><th></th></tr></thead>
      <tbody>
        ${
          live.length
            ? live
                .map((p) => {
                  const buy = unitBuyCost(p);
                  return `<tr class="clickable" data-id="${esc(p.id)}">
                    <td>${esc(p.name)}</td>
                    <td>${p.stockQty}</td>
                    <td>${p.listPriceRemote ? unitMoney(p.listPriceRemote) : "—"}</td>
                    <td>${esc(p.remotePackQty || 1)}</td>
                    <td>${buy ? unitMoney(buy) : "—"}</td>
                    <td>${temuCell(p)}</td>
                    <td class="actions">
                      <button type="button" class="ghost edit-buy" data-id="${esc(p.id)}">Editar</button>
                      <button type="button" class="ghost drop" data-id="${esc(p.id)}">Eliminar</button>
                    </td>
                  </tr>`;
                })
                .join("")
            : `<tr><td colspan="7">Sin productos para reponer.</td></tr>`
        }
      </tbody>
    </table></div>
    <h2>Historial de entradas</h2>
    ${tablePurchases(purchases, products)}`;
  el.querySelector("#new-buy").onclick = () => openRestockModal({});
  const openEdit = (id) => {
    const p = live.find((x) => x.id === id);
    if (p) openRestockModal(p);
  };
  el.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest("button, a")) return;
      openEdit(tr.dataset.id);
    };
  });
  el.querySelectorAll("button.edit-buy").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openEdit(btn.dataset.id);
    };
  });
  el.querySelectorAll("button.drop").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("¿Eliminar este producto del catálogo y vaciar el stock? El historial de compras y ventas se conserva.")) return;
      await store.archiveProduct(btn.dataset.id);
      await render();
    };
  });
}

function tablePurchases(purchases, products) {
  const name = (id) => products.find((p) => p.id === id)?.name || id;
  if (!purchases.length) return `<p class="empty">Sin compras.</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${purchases
    .map(
      (p) =>
        `<tr><td>${esc(p.purchasedOn || "")}</td><td>${esc(p.status)}</td><td>${esc(p.lines.map((l) => `${name(l.productId)} × ${l.qty}`).join(", "))}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

async function renderSales(el) {
  const [products, sales, categories] = await Promise.all([
    store.listAllProducts(),
    store.listSales(),
    store.listCategories(),
  ]);
  el.innerHTML = `
    <h1>Ventas</h1>
    <p class="empty">Marca cada pedido como comprada, apartada o cancelada. Clic en la fila para editarla.</p>
    <div class="toolbar"><button type="button" id="new-sale">Nueva venta</button></div>
    <div class="filters-bar">
      <input type="search" id="s-search" placeholder="Buscar producto o nota..." autocomplete="off">
      <select id="s-cat"><option value="">Todas las categorías</option>${categories
        .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
        .join("")}</select>
      <select id="s-status">
        <option value="">Todos los estados</option>
        <option value="sold">Comprada</option>
        <option value="reserved">Apartada</option>
        <option value="cancelled">Cancelada</option>
      </select>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Estado</th><th>Producto</th><th>Notas</th><th>Detalle</th><th></th></tr></thead>
      <tbody id="s-rows"></tbody>
    </table></div>`;
  el.querySelector("#new-sale").onclick = () => openSaleModal(products);
  const productOf = (sale) => products.find((p) => p.id === sale.lines[0]?.productId);
  const paint = () => {
    const q = el.querySelector("#s-search").value;
    const cat = el.querySelector("#s-cat").value;
    const st = el.querySelector("#s-status").value;
    const rows = sales.filter((sale) => {
      const p = productOf(sale) || {};
      const norm = sale.status === "confirmed" ? "sold" : sale.status;
      if (st && norm !== st) return false;
      if (cat && p.categoryId !== cat) return false;
      return matchesQuery(p.name, q) || matchesQuery(p.description, q) || matchesQuery(sale.notes, q);
    });
    const body = el.querySelector("#s-rows");
    body.innerHTML = rows.length
      ? rows
          .map((sale) => {
            const p = productOf(sale) || {};
            return `<tr class="clickable" data-id="${esc(sale.id)}">
              <td>${esc(sale.soldOn || "")}</td>
              <td>${esc(saleStatusLabel(sale.status))}</td>
              <td>${esc(p.name || sale.lines[0]?.productId || "")}</td>
              <td class="sale-desc">${esc(sale.notes || "—")}</td>
              <td>${esc(sale.lines.map((l) => `× ${l.qty} @ ${unitMoney(l.unitPrice)}`).join(", "))}</td>
              <td class="actions"><button type="button" class="ghost">Editar</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6">Sin ventas con ese filtro.</td></tr>`;
    body.querySelectorAll("tr.clickable").forEach((tr) => {
      tr.onclick = () => {
        const sale = sales.find((s) => s.id === tr.dataset.id);
        if (sale) openSaleModal(products, sale);
      };
    });
  };
  el.querySelector("#s-search").oninput = paint;
  el.querySelector("#s-cat").onchange = paint;
  el.querySelector("#s-status").onchange = paint;
  paint();
}

async function renderExpenses(el) {
  const expenses = await store.listExpenses();
  el.innerHTML = `
    <h1>Gastos operativos</h1>
    <p class="empty">No incluyen mercadería. El tablero de exhibición (USD 3.19) se registró como gasto.</p>
    <div class="toolbar"><button type="button" id="new-e">Nuevo gasto</button></div>
    ${simpleTable(expenses, ["spentOn", "category", "amount", "notes"])}`;
  el.querySelector("#new-e").onclick = () => {
    openSheet(`<h2>Nuevo gasto</h2>
      <form id="eform" class="stack">
        <label>Fecha <input name="spentOn" type="date" value="${today()}" required></label>
        <label>Categoría <input name="category" value="general"></label>
        <label>Monto <input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label>Notas <input name="notes"></label>
        <button type="submit">Registrar gasto</button>
        <p id="ferr" class="banner" hidden></p>
      </form>`);
    document.getElementById("eform").onsubmit = async (e) => {
      e.preventDefault();
      const unlock = lockSubmit(e.target);
      if (!unlock) return;
      try {
        await store.registerExpense(Object.fromEntries(new FormData(e.target).entries()));
        await afterSave();
      } catch (err) {
        unlock();
        const box = document.getElementById("ferr");
        box.hidden = false;
        box.textContent = err.message;
      }
    };
  };
}

async function renderCapital(el) {
  const rows = await store.listContributions();
  el.innerHTML = `
    <h1>Aportes de capital</h1>
    <div class="toolbar"><button type="button" id="new-k">Nuevo aporte</button></div>
    ${simpleTable(rows, ["personName", "amount", "contributedOn", "notes"])}`;
  el.querySelector("#new-k").onclick = () => {
    openSheet(`<h2>Nuevo aporte</h2>
      <form id="kform" class="stack">
        <label>Persona <input name="personName" required></label>
        <label>Monto <input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label>Fecha <input name="contributedOn" type="date" value="${today()}" required></label>
        <label>Notas <input name="notes"></label>
        <button type="submit">Registrar aporte</button>
        <p id="ferr" class="banner" hidden></p>
      </form>`);
    document.getElementById("kform").onsubmit = async (e) => {
      e.preventDefault();
      const unlock = lockSubmit(e.target);
      if (!unlock) return;
      try {
        await store.registerContribution(Object.fromEntries(new FormData(e.target).entries()));
        await afterSave();
      } catch (err) {
        unlock();
        const box = document.getElementById("ferr");
        box.hidden = false;
        box.textContent = err.message;
      }
    };
  };
}

async function renderKardex(el) {
  const [mov, products] = await Promise.all([store.listMovements(), store.listAllProducts()]);
  const name = (id) => products.find((p) => p.id === id)?.name || id;
  el.innerHTML = `<h1>Movimientos de inventario</h1>
    ${
      mov.length
        ? `<div class="table-wrap"><table><thead><tr><th>Cuándo</th><th>Tipo</th><th>Producto</th><th>Cant.</th><th>Costo ref.</th></tr></thead><tbody>${mov
            .map(
              (m) =>
                `<tr><td>${esc(m.occurredAt || "")}</td><td>${esc(m.movementType)}</td><td>${esc(name(m.productId))}</td><td>${m.qty}</td><td>${unitMoney(m.unitCost)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : `<p class="empty">Aún no hay movimientos.</p>`
    }`;
}

async function renderSettings(el) {
  const phones = store.getWhatsappPhones ? await store.getWhatsappPhones() : [{ label: "WhatsApp", phone: await store.getWhatsappPhone() }];
  const canPassword = Boolean(store.updatePassword) && store.mode !== "local";
  el.innerHTML = `
    <h1>Ajustes</h1>
    <p class="empty">Tres números para el catálogo (Vero, Rodri y Sofi, u otros nombres). El cliente elige a quién escribir.</p>
    <form id="aform" class="stack">
      ${[0, 1, 2]
        .map(
          (i) => `<label>Nombre ${i + 1} <input name="label${i}" value="${esc(phones[i]?.label || "")}"></label>
        <label>WhatsApp ${i + 1} (código de país + número) <input name="phone${i}" value="${esc(phones[i]?.phone || "")}"></label>`,
        )
        .join("")}
      <button type="submit">Guardar WhatsApp</button>
      <p id="ok" class="empty"></p>
    </form>
    ${
      canPassword
        ? `<h2>Cambiar contraseña</h2>
      <form id="pwform" class="stack">
        <label>Nueva contraseña <input name="password" type="password" required minlength="8"></label>
        <button type="submit">Actualizar contraseña</button>
        <p id="pwok" class="empty"></p>
      </form>`
        : `<p class="empty">En modo local la contraseña no se usa.</p>`
    }`;
  el.querySelector("#aform").onsubmit = async (e) => {
    e.preventDefault();
    const unlock = lockSubmit(e.target);
    if (!unlock) return;
    const fd = new FormData(e.target);
    try {
      await store.setWhatsappPhones([0, 1, 2].map((i) => ({ label: fd.get(`label${i}`), phone: fd.get(`phone${i}`) })));
      document.getElementById("ok").textContent = "WhatsApp guardado.";
    } finally {
      unlock();
    }
  };
  const pw = el.querySelector("#pwform");
  if (pw) {
    pw.onsubmit = async (e) => {
      e.preventDefault();
      const unlock = lockSubmit(e.target);
      if (!unlock) return;
      try {
        await store.updatePassword(new FormData(e.target).get("password"));
        document.getElementById("pwok").textContent = "Contraseña actualizada.";
        e.target.reset();
      } catch (err) {
        document.getElementById("pwok").textContent = err.message;
      } finally {
        unlock();
      }
    };
  }
}

function simpleTable(rows, keys) {
  if (!rows.length) return `<p class="empty">Sin registros.</p>`;
  return `<div class="table-wrap"><table><thead><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${keys.map((k) => `<td>${k === "amount" ? money(r[k]) : esc(r[k])}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

boot();
