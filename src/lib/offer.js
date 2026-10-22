import { money } from "./money.js";

export function impliedUnitPrice(product) {
  if (product.sellMode === "pack" && Number(product.packQty) > 0) {
    return Number(product.packPrice) / Number(product.packQty);
  }
  return Number(product.unitSalePrice || 0);
}

/** Texto de precio para el público: paquete, no costo unitario interno. */
export function publicPriceLabel(product) {
  if (product.sellMode === "pack" && Number(product.packQty) > 1) {
    return `${product.packQty} por ${money(product.packPrice)}`;
  }
  return money(product.unitSalePrice);
}

/** Costo de compra por unidad: precio Temu ÷ unidades de esa compra. */
export function unitBuyCost(product) {
  const units = Number(product.remotePackQty || 0);
  const price = Number(product.listPriceRemote || 0);
  if (!(units > 0) || !Number.isFinite(price) || price <= 0) return 0;
  return price / units;
}

export function availabilityLabel(product) {
  if (!product.available) return "Agotado";
  if (product.availabilityDisplay === "subject") return "Sujeto a disponibilidad";
  const n = Number(product.stockQty);
  return n === 1 ? "1 disponible" : `${n} disponibles`;
}

export function normalizePhones(raw, fallback = "") {
  if (Array.isArray(raw)) {
    return [0, 1, 2].map((i) => {
      const row = raw[i] || {};
      return {
        label: String(row.label || ["Vero", "Rodri", "Sofi"][i]),
        phone: String(row.phone || "").replace(/\D/g, ""),
      };
    });
  }
  const one = String(raw || fallback || "").replace(/\D/g, "");
  return [
    { label: "Vero", phone: one },
    { label: "Rodri", phone: "" },
    { label: "Sofi", phone: "" },
  ];
}
