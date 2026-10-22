import { describe, expect, it } from "vitest";
import {
  applyConfirmedPurchase,
  applyConfirmedSale,
  summarizeFinance,
  weightedAverageCost,
} from "../src/lib/inventory.js";
import { lineCost } from "../src/lib/money.js";
import { whatsappLink } from "../src/lib/whatsapp.js";
import { publicPriceLabel, impliedUnitPrice, availabilityLabel } from "../src/lib/offer.js";
import { applyWriteOff } from "../src/lib/inventory.js";

function product(partial) {
  return {
    id: "p1",
    name: "Stickers demo",
    stockQty: 0,
    avgUnitCost: 0,
    unitSalePrice: 0.125,
    ...partial,
  };
}

describe("costo promedio ponderado", () => {
  it("mezcla lotes sin usar el precio de venta", () => {
    expect(weightedAverageCost(50, 0.02, 50, 0.04)).toBe(0.03);
  });
});

describe("compra confirmada", () => {
  it("entra stock y deja historial", () => {
    const productsById = { p1: product() };
    const purchase = {
      id: "buy1",
      status: "draft",
      lines: [{ productId: "p1", qty: 54, unitCost: 0.0219 }],
    };
    const { movements } = applyConfirmedPurchase({
      purchase,
      productsById,
      actorId: "vero",
      occurredAt: "2026-10-21",
    });
    expect(purchase.status).toBe("confirmed");
    expect(productsById.p1.stockQty).toBe(54);
    expect(productsById.p1.avgUnitCost).toBe(0.0219);
    expect(movements).toHaveLength(1);
    expect(purchase.lines[0].lineCost).toBe(lineCost(54, 0.0219));
  });

  it("no se puede confirmar dos veces", () => {
    const productsById = { p1: product() };
    const purchase = { id: "buy1", status: "confirmed", lines: [{ productId: "p1", qty: 1, unitCost: 1 }] };
    expect(() =>
      applyConfirmedPurchase({ purchase, productsById, actorId: "x", occurredAt: "t" }),
    ).toThrow(/ya está confirmada/);
  });
});

describe("venta confirmada", () => {
  it("congela precio y costo y no recalcula el promedio", () => {
    const productsById = { p1: product({ stockQty: 54, avgUnitCost: 0.0219 }) };
    const sale = {
      id: "s1",
      status: "draft",
      lines: [{ productId: "p1", qty: 10, unitPrice: 0.125 }],
    };
    applyConfirmedSale({ sale, productsById, actorId: "rodri", occurredAt: "t" });
    expect(productsById.p1.stockQty).toBe(44);
    expect(productsById.p1.avgUnitCost).toBe(0.0219);
    expect(sale.lines[0].unitCost).toBe(0.0219);
    expect(sale.lines[0].unitPrice).toBe(0.125);
    expect(sale.lines[0].lineRevenue).toBe(1.25);
  });

  it("rechaza vender unidades inexistentes", () => {
    const productsById = { p1: product({ stockQty: 2, avgUnitCost: 0.5 }) };
    const sale = { id: "s1", status: "draft", lines: [{ productId: "p1", qty: 3, unitPrice: 1 }] };
    expect(() => applyConfirmedSale({ sale, productsById, actorId: "x", occurredAt: "t" })).toThrow(
      /Stock insuficiente/,
    );
    expect(productsById.p1.stockQty).toBe(2);
  });

  it("dos ventas seguidas no pueden pasar el stock", () => {
    const productsById = { p1: product({ stockQty: 5, avgUnitCost: 1 }) };
    applyConfirmedSale({
      sale: { id: "s1", status: "draft", lines: [{ productId: "p1", qty: 4, unitPrice: 2 }] },
      productsById,
      actorId: "a",
      occurredAt: "t",
    });
    expect(() =>
      applyConfirmedSale({
        sale: { id: "s2", status: "draft", lines: [{ productId: "p1", qty: 2, unitPrice: 2 }] },
        productsById,
        actorId: "b",
        occurredAt: "t",
      }),
    ).toThrow(/Stock insuficiente/);
  });
});

describe("reportes", () => {
  it("no calcula ganancia como ventas menos compras", () => {
    const products = [product({ stockQty: 40, avgUnitCost: 1 })];
    const summary = summarizeFinance({
      contributions: [{ amount: 45 }],
      purchases: [
        {
          status: "confirmed",
          lines: [{ qty: 50, unitCost: 1, lineCost: 50 }],
        },
      ],
      sales: [
        {
          status: "confirmed",
          lines: [{ qty: 10, unitPrice: 2, unitCost: 1, lineRevenue: 20, lineCogs: 10 }],
        },
      ],
      expenses: [{ amount: 3 }],
      products,
    });
    expect(summary.salesRevenue - summary.merchandisePurchased).toBe(-30);
    expect(summary.grossProfit).toBe(10);
    expect(summary.cogs).toBe(10);
    expect(summary.merchandisePurchased).toBe(50);
    expect(summary.capital).toBe(45);
    expect(summary.operatingExpenses).toBe(3);
    expect(summary.operatingResult).toBe(7);
    expect(summary.inventoryValue).toBe(40);
    expect(summary.estimatedCash).toBe(12);
  });

  it("ignora borradores de venta y compra", () => {
    const summary = summarizeFinance({
      purchases: [{ status: "draft", lines: [{ qty: 1, unitCost: 9, lineCost: 9 }] }],
      sales: [{ status: "draft", lines: [{ qty: 1, unitPrice: 5, lineRevenue: 5, lineCogs: 1 }] }],
    });
    expect(summary.merchandisePurchased).toBe(0);
    expect(summary.salesRevenue).toBe(0);
    expect(summary.cogs).toBe(0);
  });
});

describe("whatsapp", () => {
  it("arma el enlace solo con dígitos", () => {
    expect(whatsappLink("+503 7777-8888", "hola")).toBe(
      "https://wa.me/50377778888?text=hola",
    );
    expect(whatsappLink("", "hola")).toBeNull();
  });
});

describe("oferta pública", () => {
  it("muestra paquete, no el unitario interno", () => {
    const p = { sellMode: "pack", packQty: 2, packPrice: 0.25, unitSalePrice: 0.125, stockQty: 50, available: true, availabilityDisplay: "subject" };
    expect(publicPriceLabel(p)).toMatch(/2 por/);
    expect(impliedUnitPrice(p)).toBeCloseTo(0.125);
    expect(availabilityLabel(p)).toBe("Sujeto a disponibilidad");
  });

  it("vacía inventario sin borrar el producto", () => {
    const product = { id: "p1", stockQty: 8, avgUnitCost: 0.2 };
    const { movement } = applyWriteOff({ product, actorId: "a", occurredAt: "t" });
    expect(product.stockQty).toBe(0);
    expect(movement.qty).toBe(-8);
  });
});
