import { getStore, fictionalCatalog } from "./lib/store.js";
import { money, unitMoney } from "./lib/money.js";

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
    <h1>Panel Venta Loca</h1>
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
      <div class="brand">Venta <span>Loca</span></div>
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
  return `<form id="pform" class="stack">
    <input type="hidden" name="id" value="${esc(p.id || "")}">
    <label>Nombre <input name="name" required value="${esc(p.name || "")}"></label>
    <label>Descripción <textarea name="description">${esc(p.description || "")}</textarea></label>
    <label>Categoría <select name="categoryId">${categories
      .map((c) => `<option value="${esc(c.id)}" ${p.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`)
      .join("")}</select></label>
    <label>Link Temu <input name="temuUrl" value="${esc(p.temuUrl || "")}"></label>
    <label>Precio real Temu (informativo) <input name="listPriceRemote" type="number" step="0.01" value="${esc(p.listPriceRemote ?? 0)}"></label>
    <label>Precio venta unidad <input name="unitSalePrice" type="number" step="0.0001" required value="${esc(p.unitSalePrice ?? "")}"></label>
    <label>URL de foto (modo local) <input name="imageUrl" value="${esc(p.imageUrl || "")}"></label>
    <label>Foto (Supabase Storage) <input name="imageFile" type="file" accept="image/*"></label>
    <label class="check"><input type="checkbox" name="isPublished" ${p.isPublished ? "checked" : ""}> Publicado en catálogo</label>
    <button type="submit">${p.id ? "Guardar cambios" : "Crear producto"}</button>
    <p id="ferr" class="banner" hidden></p>
  </form>`;
}

function bindProductForm(categoriesLookup) {
  document.getElementById("pform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById("ferr");
    try {
      await store.saveProduct({
        id: fd.get("id") || undefined,
        name: fd.get("name"),
        description: fd.get("description"),
        categoryId: fd.get("categoryId"),
        temuUrl: fd.get("temuUrl"),
        listPriceRemote: fd.get("listPriceRemote"),
        unitSalePrice: fd.get("unitSalePrice"),
        imageUrl: fd.get("imageUrl"),
        imageFile: fd.get("imageFile")?.size ? fd.get("imageFile") : null,
        isPublished: fd.get("isPublished") === "on",
      });
      await afterSave();
    } catch (err) {
      errBox.hidden = false;
      errBox.textContent = err.message;
    }
  };
  void categoriesLookup;
}

async function renderProducts(el) {
  const [products, categories] = await Promise.all([store.listAllProducts(), store.listCategories()]);
  el.innerHTML = `
    <h1>Productos</h1>
    <p class="empty">El inventario vive aquí. Clic en una fila o en Editar para cambiar nombre, precio u otros datos. Las compras y ventas se registran en un recuadro, no en un formulario eterno.</p>
    <div class="toolbar">
      <button type="button" id="new-p">Nuevo producto</button>
      <button type="button" class="secondary" id="new-buy">Registrar compra</button>
      <button type="button" class="secondary" id="new-sale">Registrar venta</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Categoría</th><th>Stock</th><th>Costo prom.</th><th>Precio</th><th>Público</th><th></th></tr></thead>
      <tbody>
        ${
          products.length
            ? products
                .map(
                  (p) => `<tr class="clickable" data-id="${esc(p.id)}">
                    <td>${esc(p.name)}</td>
                    <td>${esc(p.categoryName || "")}</td>
                    <td>${p.stockQty}</td>
                    <td>${unitMoney(p.avgUnitCost)}</td>
                    <td>${unitMoney(p.unitSalePrice)}</td>
                    <td>${p.isPublished ? "sí" : "no"}</td>
                    <td class="actions"><button type="button" class="ghost edit" data-id="${esc(p.id)}">Editar</button></td>
                  </tr>`,
                )
                .join("")
            : `<tr><td colspan="7">Sin productos.</td></tr>`
        }
      </tbody>
    </table></div>`;

  const openProduct = (id) => {
    const p = products.find((x) => x.id === id) || {};
    openSheet(`<h2>${id ? "Editar producto" : "Nuevo producto"}</h2>${productForm(categories, p)}`);
    bindProductForm();
  };

  el.querySelector("#new-p").onclick = () => openProduct("");
  el.querySelector("#new-buy").onclick = () => openPurchaseModal(products);
  el.querySelector("#new-sale").onclick = () => openSaleModal(products);
  el.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest("button")) return;
      openProduct(tr.dataset.id);
    };
  });
  el.querySelectorAll("button.edit").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openProduct(btn.dataset.id);
    };
  });
}

function openPurchaseModal(products) {
  openSheet(`<h2>Registrar compra</h2>
    <p class="empty">Confirmar entra stock y actualiza el costo promedio. No es un gasto operativo.</p>
    <form id="cform" class="stack">
      <label>Fecha <input name="purchasedOn" type="date" value="${today()}" required></label>
      <label>Notas <input name="notes"></label>
      <label>Producto <select name="productId">${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
      <label>Cantidad <input name="qty" type="number" min="1" step="1" required></label>
      <label>Costo unitario <input name="unitCost" type="number" min="0" step="0.0001" required></label>
      <button type="submit">Confirmar compra</button>
      <p id="ferr" class="banner" hidden></p>
    </form>`);
  document.getElementById("cform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const draft = await store.createPurchaseDraft({
        purchasedOn: fd.get("purchasedOn"),
        notes: fd.get("notes"),
        lines: [{ productId: fd.get("productId"), qty: fd.get("qty"), unitCost: fd.get("unitCost") }],
      });
      await store.confirmPurchase(draft.id);
      await afterSave();
    } catch (err) {
      const box = document.getElementById("ferr");
      box.hidden = false;
      box.textContent = err.message;
    }
  };
}

function openSaleModal(products) {
  openSheet(`<h2>Registrar venta</h2>
    <p class="empty">Al confirmar se descuenta stock y se congelan precio y costo de ese momento.</p>
    <form id="sform" class="stack">
      <label>Fecha <input name="soldOn" type="date" value="${today()}" required></label>
      <label>Notas <input name="notes"></label>
      <label>Producto <select name="productId">${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.stockQty})</option>`).join("")}</select></label>
      <label>Cantidad <input name="qty" type="number" min="1" step="1" required></label>
      <label>Precio unitario <input name="unitPrice" type="number" min="0" step="0.0001" required></label>
      <button type="submit">Confirmar venta</button>
      <p id="ferr" class="banner" hidden></p>
    </form>`);
  const select = document.querySelector("#sform [name=productId]");
  const price = document.querySelector("#sform [name=unitPrice]");
  const fillPrice = () => {
    const p = products.find((x) => x.id === select.value);
    if (p) price.value = p.unitSalePrice;
  };
  fillPrice();
  select.onchange = fillPrice;
  document.getElementById("sform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const draft = await store.createSaleDraft({
        soldOn: fd.get("soldOn"),
        notes: fd.get("notes"),
        lines: [{ productId: fd.get("productId"), qty: fd.get("qty"), unitPrice: fd.get("unitPrice") }],
      });
      await store.confirmSale(draft.id);
      await afterSave();
    } catch (err) {
      const box = document.getElementById("ferr");
      box.hidden = false;
      box.textContent = err.message;
    }
  };
}

async function renderPurchases(el) {
  const [products, purchases] = await Promise.all([store.listAllProducts(), store.listPurchases()]);
  el.innerHTML = `
    <h1>Compras de mercadería</h1>
    <div class="toolbar"><button type="button" id="new-buy">Nueva compra</button></div>
    ${tablePurchases(purchases, products)}`;
  el.querySelector("#new-buy").onclick = () => openPurchaseModal(products);
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
  const [products, sales] = await Promise.all([store.listAllProducts(), store.listSales()]);
  el.innerHTML = `
    <h1>Ventas</h1>
    <div class="toolbar"><button type="button" id="new-sale">Nueva venta</button></div>
    ${tableSales(sales, products)}`;
  el.querySelector("#new-sale").onclick = () => openSaleModal(products);
}

function tableSales(sales, products) {
  const name = (id) => products.find((p) => p.id === id)?.name || id;
  if (!sales.length) return `<p class="empty">Sin ventas confirmadas.</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${sales
    .map(
      (p) =>
        `<tr><td>${esc(p.soldOn || "")}</td><td>${esc(p.status)}</td><td>${esc(
          p.lines.map((l) => `${name(l.productId)} × ${l.qty} @ ${unitMoney(l.unitPrice)} (costo ${unitMoney(l.unitCost)})`).join(", "),
        )}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
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
      try {
        await store.registerExpense(Object.fromEntries(new FormData(e.target).entries()));
        await afterSave();
      } catch (err) {
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
      try {
        await store.registerContribution(Object.fromEntries(new FormData(e.target).entries()));
        await afterSave();
      } catch (err) {
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
  const phone = await store.getWhatsappPhone();
  const canPassword = Boolean(store.updatePassword) && store.mode !== "local";
  el.innerHTML = `
    <h1>Ajustes</h1>
    <form id="aform" class="stack">
      <label>WhatsApp (código de país + número) <input name="phone" value="${esc(phone)}"></label>
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
    await store.setWhatsappPhone(new FormData(e.target).get("phone"));
    document.getElementById("ok").textContent = "WhatsApp guardado.";
  };
  const pw = el.querySelector("#pwform");
  if (pw) {
    pw.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await store.updatePassword(new FormData(e.target).get("password"));
        document.getElementById("pwok").textContent = "Contraseña actualizada.";
        e.target.reset();
      } catch (err) {
        document.getElementById("pwok").textContent = err.message;
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
