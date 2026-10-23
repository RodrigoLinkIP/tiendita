import { createId } from "./id.js";
import {
  applyConfirmedPurchase,
  applyConfirmedSale,
  applySaleUpdate,
  applyWriteOff,
  STATUS,
  summarizeFinance,
} from "./inventory.js";
import { impliedUnitPrice, normalizePhones } from "./offer.js";

const KEY = "venta-loca-local-v1";

function emptyState() {
  return {
    categories: [
      { id: "cat-stickers", name: "Stickers", slug: "stickers", sortOrder: 1 },
      { id: "cat-pines", name: "Pines", slug: "pines", sortOrder: 2 },
      { id: "cat-ganchos", name: "Ganchos", slug: "ganchos", sortOrder: 3 },
      { id: "cat-figuras", name: "Figuras", slug: "figuras", sortOrder: 4 },
      { id: "cat-espejos", name: "Espejos", slug: "espejos", sortOrder: 5 },
      { id: "cat-otros", name: "Otros", slug: "otros", sortOrder: 6 },
    ],
    products: [],
    images: [],
    contributions: [],
    purchases: [],
    sales: [],
    expenses: [],
    movements: [],
    settings: {
      whatsappPhone: import.meta.env?.VITE_WHATSAPP_PHONE || "",
      whatsappPhones: normalizePhones([], import.meta.env?.VITE_WHATSAPP_PHONE || ""),
    },
    session: null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const TEST_ADMINS = [
  { email: "vero@local.test", displayName: "Vero" },
  { email: "rodri@local.test", displayName: "Rodri" },
  { email: "sofi@local.test", displayName: "Sofi" },
];

export function createLocalStore() {
  return {
    mode: "local",

    async getSession() {
      return load().session;
    },

    async signIn(email) {
      const admin = TEST_ADMINS.find((a) => a.email === email.trim().toLowerCase());
      if (!admin) throw new Error("Este correo no está autorizado en modo local");
      const state = load();
      state.session = { userId: admin.email, email: admin.email, displayName: admin.displayName };
      save(state);
      return state.session;
    },

    async signOut() {
      const state = load();
      state.session = null;
      save(state);
    },

    async listPublishedProducts() {
      const state = load();
      return state.products
        .filter((p) => p.isPublished && !p.archivedAt && Number(p.stockQty) > 0)
        .map((p) => hydrateProduct(p, state));
    },

    async listCategories() {
      return load().categories;
    },

    async getWhatsappPhones() {
      const s = load().settings;
      return normalizePhones(s.whatsappPhones, s.whatsappPhone);
    },

    async getWhatsappPhone() {
      const phones = await this.getWhatsappPhones();
      return phones.find((p) => p.phone)?.phone || "";
    },

    async listAllProducts() {
      const state = load();
      return state.products.map((p) => hydrateProduct(p, state));
    },

    async saveProduct(input) {
      return serial(async () => {
        const state = load();
        const id = input.id || createId();
        const existing = state.products.find((p) => p.id === id);
        const product = {
          id,
          name: input.name.trim(),
          description: input.description?.trim() || "",
          categoryId: input.categoryId || null,
          temuUrl: input.temuUrl !== undefined ? input.temuUrl || "" : existing?.temuUrl || "",
          listPriceRemote:
            input.listPriceRemote !== undefined ? Number(input.listPriceRemote || 0) : Number(existing?.listPriceRemote || 0),
          remotePackQty:
            input.remotePackQty !== undefined
              ? Math.max(1, Math.floor(Number(input.remotePackQty || 1)))
              : Math.max(1, Number(existing?.remotePackQty || 1)),
          sellMode: input.sellMode === "pack" ? "pack" : "unit",
          packQty: input.sellMode === "pack" ? Math.max(2, Number(input.packQty || 2)) : 1,
          packPrice: input.sellMode === "pack" ? Number(input.packPrice || 0) : 0,
          unitSalePrice:
            input.sellMode === "pack" ? impliedUnitPrice(input) : Number(input.unitSalePrice || 0),
          availabilityDisplay: input.availabilityDisplay === "subject" ? "subject" : "count",
          stockQty:
            input.stockQty !== undefined ? Math.max(0, Math.floor(Number(input.stockQty || 0))) : (existing?.stockQty ?? 0),
          avgUnitCost:
            input.avgUnitCost !== undefined ? Math.max(0, Number(input.avgUnitCost || 0)) : (existing?.avgUnitCost ?? 0),
          isPublished: (input.stockQty !== undefined ? Math.max(0, Math.floor(Number(input.stockQty || 0))) : (existing?.stockQty ?? 0)) <= 0
            ? false
            : Boolean(input.isPublished),
          archivedAt: existing?.archivedAt || null,
        };
        state.products = existing
          ? state.products.map((p) => (p.id === id ? product : p))
          : [...state.products, product];
        const current = state.images.filter((i) => i.productId === id);
        let order = current.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), -1) + 1;
        const extraUrls = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
        for (const url of extraUrls) {
          current.push({ id: createId(), productId: id, publicUrl: String(url).trim(), sortOrder: order++ });
        }
        const files = [...(input.imageFiles || [])].filter((f) => f && f.size);
        for (const file of files) {
          current.push({
            id: createId(),
            productId: id,
            publicUrl: URL.createObjectURL(file),
            sortOrder: order++,
          });
        }
        state.images = [...state.images.filter((i) => i.productId !== id), ...current];
        save(state);
        return hydrateProduct(product, state);
      });
    },

    async removeProductImage(imageId) {
      return serial(async () => {
        const state = load();
        state.images = state.images.filter((i) => i.id !== imageId);
        save(state);
      });
    },

    async createPurchaseDraft({ purchasedOn, notes, lines }) {
      return serial(async () => {
        const state = load();
        const purchase = {
          id: createId(),
          status: STATUS.draft,
          purchasedOn,
          notes: notes || "",
          lines: lines.map((l) => ({
            id: createId(),
            productId: l.productId,
            qty: Number(l.qty),
            unitCost: Number(l.unitCost),
          })),
        };
        state.purchases.push(purchase);
        save(state);
        return purchase;
      });
    },

    async confirmPurchase(purchaseId) {
      return serial(async () => {
        const state = load();
        const purchase = state.purchases.find((p) => p.id === purchaseId);
        if (!purchase) throw new Error("Compra no encontrada");
        const productsById = Object.fromEntries(state.products.map((p) => [p.id, { ...p }]));
        const result = applyConfirmedPurchase({
          purchase: structuredClone(purchase),
          productsById,
          actorId: state.session?.userId || "local",
          occurredAt: new Date().toISOString(),
        });
        Object.assign(purchase, result.purchase);
        state.products = state.products.map((p) => productsById[p.id] || p);
        state.movements.push(...result.movements);
        save(state);
        return purchase;
      });
    },

    async createSaleDraft({ soldOn, notes, lines }) {
      return serial(async () => {
        const state = load();
        const sale = {
          id: createId(),
          status: STATUS.draft,
          soldOn,
          notes: notes || "",
          lines: lines.map((l) => ({
            id: createId(),
            productId: l.productId,
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice),
          })),
        };
        state.sales.push(sale);
        save(state);
        return sale;
      });
    },

    async confirmSale(saleId) {
      return serial(async () => {
        const state = load();
        const sale = state.sales.find((p) => p.id === saleId);
        if (!sale) throw new Error("Venta no encontrada");
        const productsById = Object.fromEntries(state.products.map((p) => [p.id, { ...p }]));
        const result = applyConfirmedSale({
          sale: structuredClone(sale),
          productsById,
          actorId: state.session?.userId || "local",
          occurredAt: new Date().toISOString(),
        });
        Object.assign(sale, result.sale);
        state.products = state.products.map((p) => productsById[p.id] || p);
        state.movements.push(...result.movements);
        save(state);
        return sale;
      });
    },

    async saveSale(input) {
      return serial(async () => {
        const state = load();
        let sale = input.id ? state.sales.find((p) => p.id === input.id) : null;
        if (input.id && !sale) throw new Error("Venta no encontrada");
        if (!sale) {
          sale = { id: createId(), status: STATUS.draft, soldOn: input.soldOn, notes: "", lines: [] };
          state.sales.push(sale);
        }
        const productsById = Object.fromEntries(state.products.map((p) => [p.id, { ...p }]));
        const result = applySaleUpdate({
          sale: structuredClone(sale),
          productsById,
          patch: {
            status: input.status,
            soldOn: input.soldOn,
            notes: input.notes || "",
            lines: input.lines,
          },
          actorId: state.session?.userId || "local",
          occurredAt: new Date().toISOString(),
        });
        Object.assign(sale, result.sale);
        state.products = state.products.map((p) => productsById[p.id] || p);
        state.movements.push(...result.movements);
        save(state);
        return sale;
      });
    },

    async registerExpense(input) {
      return serial(async () => {
        const state = load();
        const row = {
          id: createId(),
          spentOn: input.spentOn,
          category: input.category || "general",
          amount: Number(input.amount),
          notes: input.notes || "",
          createdBy: state.session?.userId || "local",
        };
        state.expenses.push(row);
        save(state);
        return row;
      });
    },

    async registerContribution(input) {
      return serial(async () => {
        const state = load();
        const row = {
          id: createId(),
          personName: input.personName,
          amount: Number(input.amount),
          contributedOn: input.contributedOn,
          notes: input.notes || "",
          createdBy: state.session?.userId || "local",
        };
        state.contributions.push(row);
        save(state);
        return row;
      });
    },

    async setWhatsappPhones(phones) {
      const state = load();
      state.settings.whatsappPhones = normalizePhones(phones);
      state.settings.whatsappPhone = state.settings.whatsappPhones.find((p) => p.phone)?.phone || "";
      save(state);
    },

    async setWhatsappPhone(phone) {
      await this.setWhatsappPhones([{ label: "WhatsApp", phone }]);
    },

    async writeOffStock(productId) {
      return serial(async () => {
        const state = load();
        const product = state.products.find((p) => p.id === productId);
        if (!product) throw new Error("Producto inexistente");
        const { movement } = applyWriteOff({
          product,
          actorId: state.session?.userId || "local",
          occurredAt: new Date().toISOString(),
        });
        if (movement) state.movements.push(movement);
        save(state);
      });
    },

    async archiveProduct(productId) {
      await this.writeOffStock(productId);
      return serial(async () => {
        const state = load();
        const product = state.products.find((p) => p.id === productId);
        if (!product) throw new Error("Producto inexistente");
        product.isPublished = false;
        product.archivedAt = new Date().toISOString();
        save(state);
      });
    },

    async listPurchases() {
      return load().purchases;
    },
    async listSales() {
      return load().sales;
    },
    async listExpenses() {
      return load().expenses;
    },
    async listContributions() {
      return load().contributions;
    },
    async listMovements() {
      return load().movements.slice().reverse();
    },

    async report() {
      const state = load();
      return summarizeFinance(state);
    },

    async reset() {
      localStorage.removeItem(KEY);
    },

    async loadFixture(statePatch) {
      const state = { ...emptyState(), ...statePatch };
      save(state);
      return state;
    },
  };
}

function hydrateProduct(p, state) {
  const category = state.categories.find((c) => c.id === p.categoryId);
  const images = state.images.filter((i) => i.productId === p.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return {
    ...p,
    categoryName: category?.name || "Sin categoría",
    imageUrl: images[0]?.publicUrl || "",
    images: images.map((img) => ({ id: img.id, url: img.publicUrl, sortOrder: img.sortOrder })),
    available: p.stockQty > 0,
  };
}

export function fictionalCatalog() {
  return {
    products: [
      {
        id: "p-demo-1",
        name: "Stickers de prueba (lote ficticio)",
        description: "Dato de prueba. No forma parte del Excel real.",
        categoryId: "cat-stickers",
        temuUrl: "",
        listPriceRemote: 2.0,
        remotePackQty: 50,
        unitSalePrice: 0.15,
        sellMode: "pack",
        packQty: 2,
        packPrice: 0.3,
        availabilityDisplay: "subject",
        stockQty: 10,
        avgUnitCost: 0.04,
        isPublished: true,
      },
      {
        id: "p-demo-2",
        name: "Pin de prueba",
        description: "Dato de prueba para el catálogo local.",
        categoryId: "cat-pines",
        temuUrl: "",
        listPriceRemote: 3.0,
        remotePackQty: 1,
        unitSalePrice: 1.5,
        sellMode: "unit",
        packQty: 1,
        packPrice: 0,
        availabilityDisplay: "count",
        stockQty: 0,
        avgUnitCost: 0.5,
        isPublished: true,
      },
    ],
    images: [],
    contributions: [{ id: "c1", personName: "Demo", amount: 20, contributedOn: "2026-01-01" }],
    purchases: [],
    sales: [],
    expenses: [],
    movements: [],
  };
}
