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

/** Costo de una pieza: precio Temu de un producto ÷ unidades que trae ese producto. */
export function unitBuyCost(product) {
  const price = Number(product.listPriceRemote || 0);
  const inside = Number(product.remotePackQty || 0);
  if (!(inside > 0) || !Number.isFinite(price) || price <= 0) return 0;
  return price / inside;
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
