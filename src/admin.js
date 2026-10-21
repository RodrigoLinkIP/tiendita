import { getStore, fictionalCatalog } from "./lib/store.js";
import { money, unitMoney } from "./lib/money.js";

const store = getStore();
const app = document.getElementById("app");
const today = () => new Date().toISOString().slice(0, 10);

const routes = {
  "#/resumen": renderReport,
  "#/productos": renderProducts,
  "#/compras": renderPurchases,
  "#/ventas": renderSales,
  "#/gastos": renderExpenses,
  "#/capital": renderCapital,
  "#/kardex": renderKardex,
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
  const hash = routes[location.hash] ? location.hash : "#/resumen";
  if (location.hash !== hash) location.hash = hash;
  app.innerHTML = shell(session, hash);
  document.getElementById("logout").onclick = async () => {
    await store.signOut();
    render();
  };
  try {
    await routes[hash](document.getElementById("view"));
  } catch (err) {
    document.getElementById("view").innerHTML = `<p class="banner">${err.message}</p>`;
  }
}

function loginView() {
  const localHint =
    store.mode === "local"
      ? `<p class="empty">Modo local: usa vero@local.test, rodri@local.test o sofi@local.test. La contraseña se ignora.</p>`
      : `<p class="empty">Ingresa con el correo autorizado en Supabase Auth.</p>`;
  return `<form class="login stack" id="login">
    <h1>Panel Venta Loca</h1>
    ${localHint}
    <label>Correo <input name="email" type="email" required></label>
    <label>Contraseña <input name="password" type="password"></label>
    <button type="submit">Entrar</button>
    <p id="err" class="empty"></p>
  </form>`;
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
    ["#/resumen", "Resumen"],
    ["#/productos", "Productos"],
    ["#/compras", "Compras"],
    ["#/ventas", "Ventas"],
    ["#/gastos", "Gastos"],
    ["#/capital", "Capital"],
    ["#/kardex", "Inventario"],
    ["#/ajustes", "Ajustes"],
  ];
  return `<div class="admin-shell">
    <aside class="side">
      <div class="brand">Venta <span>Loca</span></div>
      <p>${session.displayName}</p>
      ${links.map(([href, label]) => `<a class="${hash === href ? "active" : ""}" href="${href}">${label}</a>`).join("")}
      <p><a href="./index.html">Ver catálogo</a></p>
      <button class="ghost" id="logout">Salir</button>
    </aside>
    <main class="main"><div id="view"></div></main>
  </div>`;
}

async function renderReport(el) {
  const r = await store.report();
  el.innerHTML = `
    <h1>Resumen financiero</h1>
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
      <div class="kpi note">La ganancia no es ventas menos compras. Las compras dejan inventario; la ganancia bruta usa solo lo vendido. El efectivo estimado asume cobros y pagos de contado; no está en el Excel.</div>
    </div>`;
}

function kpi(label, value) {
  return `<div class="kpi"><span>${label}</span><b>${money(value)}</b></div>`;
}

async function renderProducts(el) {
  const [products, categories] = await Promise.all([store.listAllProducts(), store.listCategories()]);
  el.innerHTML = `
    <h1>Productos</h1>
    <form id="pform" class="stack">
      <input type="hidden" name="id">
      <label>Nombre <input name="name" required></label>
      <label>Descripción <textarea name="description"></textarea></label>
      <label>Categoría <select name="categoryId">${categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select></label>
      <label>Link Temu <input name="temuUrl"></label>
      <label>Precio real Temu (informativo) <input name="listPriceRemote" type="number" step="0.01" value="0"></label>
      <label>Precio venta unidad <input name="unitSalePrice" type="number" step="0.0001" required></label>
      <label>URL de foto (modo local) <input name="imageUrl"></label>
      <label>Foto (Supabase Storage) <input name="imageFile" type="file" accept="image/*"></label>
      <label><input type="checkbox" name="isPublished"> Publicado en catálogo</label>
      <button>Guardar producto</button>
    </form>
    <h2>Existencias</h2>
    <table><thead><tr><th>Nombre</th><th>Stock</th><th>Costo prom.</th><th>Precio</th><th>Público</th></tr></thead>
    <tbody>${products
      .map(
        (p) =>
          `<tr><td>${p.name}</td><td>${p.stockQty}</td><td>${unitMoney(p.avgUnitCost)}</td><td>${unitMoney(p.unitSalePrice)}</td><td>${p.isPublished ? "sí" : "no"}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  el.querySelector("#pform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
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
    await render();
  };
}

async function renderPurchases(el) {
  const [products, purchases] = await Promise.all([store.listAllProducts(), store.listPurchases()]);
  el.innerHTML = `
    <h1>Compras de mercadería</h1>
    <p class="empty">Confirmar una compra entra stock y actualiza el costo promedio. No es un gasto operativo.</p>
    <form id="cform" class="stack">
      <label>Fecha <input name="purchasedOn" type="date" value="${today()}" required></label>
      <label>Notas <input name="notes"></label>
      <label>Producto <select name="productId">${products.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select></label>
      <label>Cantidad <input name="qty" type="number" min="1" step="1" required></label>
      <label>Costo unitario <input name="unitCost" type="number" min="0" step="0.0001" required></label>
      <button>Confirmar compra</button>
    </form>
    ${tablePurchases(purchases, products)}`;
  el.querySelector("#cform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const draft = await store.createPurchaseDraft({
      purchasedOn: fd.get("purchasedOn"),
      notes: fd.get("notes"),
      lines: [{ productId: fd.get("productId"), qty: fd.get("qty"), unitCost: fd.get("unitCost") }],
    });
    await store.confirmPurchase(draft.id);
    await render();
  };
}

function tablePurchases(purchases, products) {
  const name = (id) => products.find((p) => p.id === id)?.name || id;
  if (!purchases.length) return `<p class="empty">Sin compras.</p>`;
  return `<table><thead><tr><th>Fecha</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${purchases
    .map(
      (p) =>
        `<tr><td>${p.purchasedOn || ""}</td><td>${p.status}</td><td>${p.lines.map((l) => `${name(l.productId)} × ${l.qty}`).join(", ")}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

async function renderSales(el) {
  const [products, sales] = await Promise.all([store.listAllProducts(), store.listSales()]);
  el.innerHTML = `
    <h1>Ventas</h1>
    <p class="empty">Al confirmar se descuenta stock y se congelan precio y costo unitario de ese momento.</p>
    <form id="sform" class="stack">
      <label>Fecha <input name="soldOn" type="date" value="${today()}" required></label>
      <label>Notas <input name="notes"></label>
      <label>Producto <select name="productId">${products.map((p) => `<option value="${p.id}">${p.name} (${p.stockQty})</option>`).join("")}</select></label>
      <label>Cantidad <input name="qty" type="number" min="1" step="1" required></label>
      <label>Precio unitario <input name="unitPrice" type="number" min="0" step="0.0001" required></label>
      <button>Confirmar venta</button>
    </form>
    <p id="serr" class="banner" hidden></p>
    ${tableSales(sales, products)}`;
  el.querySelector("#sform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById("serr");
    try {
      const draft = await store.createSaleDraft({
        soldOn: fd.get("soldOn"),
        notes: fd.get("notes"),
        lines: [{ productId: fd.get("productId"), qty: fd.get("qty"), unitPrice: fd.get("unitPrice") }],
      });
      await store.confirmSale(draft.id);
      await render();
    } catch (err) {
      errBox.hidden = false;
      errBox.textContent = err.message;
    }
  };
}

function tableSales(sales, products) {
  const name = (id) => products.find((p) => p.id === id)?.name || id;
  if (!sales.length) return `<p class="empty">Sin ventas confirmadas.</p>`;
  return `<table><thead><tr><th>Fecha</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${sales
    .map(
      (p) =>
        `<tr><td>${p.soldOn || ""}</td><td>${p.status}</td><td>${p.lines
          .map((l) => `${name(l.productId)} × ${l.qty} @ ${unitMoney(l.unitPrice)} (costo ${unitMoney(l.unitCost)})`)
          .join(", ")}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

async function renderExpenses(el) {
  const expenses = await store.listExpenses();
  el.innerHTML = `
    <h1>Gastos operativos</h1>
    <p class="empty">No incluyen mercadería. El tablero de exhibición, si se trata como gasto, iría aquí cuando se confirme esa decisión.</p>
    <form id="eform" class="stack">
      <label>Fecha <input name="spentOn" type="date" value="${today()}" required></label>
      <label>Categoría <input name="category" value="general"></label>
      <label>Monto <input name="amount" type="number" min="0.01" step="0.01" required></label>
      <label>Notas <input name="notes"></label>
      <button>Registrar gasto</button>
    </form>
    ${simpleTable(expenses, ["spentOn", "category", "amount", "notes"])}`;
  el.querySelector("#eform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await store.registerExpense(Object.fromEntries(fd.entries()));
    await render();
  };
}

async function renderCapital(el) {
  const rows = await store.listContributions();
  el.innerHTML = `
    <h1>Aportes de capital</h1>
    <form id="kform" class="stack">
      <label>Persona <input name="personName" required></label>
      <label>Monto <input name="amount" type="number" min="0.01" step="0.01" required></label>
      <label>Fecha <input name="contributedOn" type="date" value="${today()}" required></label>
      <label>Notas <input name="notes"></label>
      <button>Registrar aporte</button>
    </form>
    ${simpleTable(rows, ["personName", "amount", "contributedOn", "notes"])}`;
  el.querySelector("#kform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await store.registerContribution(Object.fromEntries(fd.entries()));
    await render();
  };
}

async function renderKardex(el) {
  const [mov, products] = await Promise.all([store.listMovements(), store.listAllProducts()]);
  const name = (id) => products.find((p) => p.id === id)?.name || id;
  el.innerHTML = `<h1>Movimientos de inventario</h1>
    ${
      mov.length
        ? `<table><thead><tr><th>Cuándo</th><th>Tipo</th><th>Producto</th><th>Cant.</th><th>Costo ref.</th></tr></thead><tbody>${mov
            .map(
              (m) =>
                `<tr><td>${m.occurredAt || ""}</td><td>${m.movementType}</td><td>${name(m.productId)}</td><td>${m.qty}</td><td>${unitMoney(m.unitCost)}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : `<p class="empty">Aún no hay movimientos.</p>`
    }`;
}

async function renderSettings(el) {
  const phone = await store.getWhatsappPhone();
  el.innerHTML = `
    <h1>Ajustes</h1>
    <p class="banner">Backend: ${store.mode}. Sin service_role en el cliente.</p>
    <form id="aform" class="stack">
      <label>WhatsApp (código de país + número) <input name="phone" value="${phone}"></label>
      <button>Guardar</button>
    </form>`;
  el.querySelector("#aform").onsubmit = async (e) => {
    e.preventDefault();
    await store.setWhatsappPhone(new FormData(e.target).get("phone"));
    await render();
  };
}

function simpleTable(rows, keys) {
  if (!rows.length) return `<p class="empty">Sin registros.</p>`;
  return `<table><thead><tr>${keys.map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${keys.map((k) => `<td>${k === "amount" ? money(r[k]) : r[k] ?? ""}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

boot();
