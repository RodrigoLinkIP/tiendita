import { lineCost, roundTo } from "./money.js";

export const STATUS = {
  draft: "draft",
  confirmed: "confirmed",
};

export function weightedAverageCost(stockQty, avgUnitCost, incomingQty, incomingUnitCost) {
  const stock = Number(stockQty);
  const incoming = Number(incomingQty);
  const totalQty = stock + incoming;
  if (totalQty <= 0) return 0;
  const existingValue = stock * Number(avgUnitCost);
  const incomingValue = incoming * Number(incomingUnitCost);
  return roundTo((existingValue + incomingValue) / totalQty, 4);
}

export function assertPositiveQty(qty) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("La cantidad debe ser un entero positivo");
  }
  return n;
}

/**
 * Confirma una compra contra un snapshot de productos.
 * productsById se muta. movements y purchase.status se actualizan.
 */
export function applyConfirmedPurchase({ purchase, productsById, actorId, occurredAt }) {
  if (purchase.status === STATUS.confirmed) {
    throw new Error("La compra ya está confirmada");
  }
  if (!purchase.lines?.length) {
    throw new Error("La compra no tiene líneas");
  }

  const movements = [];
  for (const line of purchase.lines) {
    const qty = assertPositiveQty(line.qty);
    const product = productsById[line.productId];
    if (!product) throw new Error("Producto inexistente");
    const unitCost = Number(line.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new Error("Costo unitario inválido");
    }
    const nextAvg = weightedAverageCost(product.stockQty, product.avgUnitCost, qty, unitCost);
    product.stockQty += qty;
    product.avgUnitCost = nextAvg;
    line.lineCost = lineCost(qty, unitCost);
    movements.push({
      productId: product.id,
      movementType: "purchase",
      qty,
      unitCost,
      referenceType: "purchase",
      referenceId: purchase.id,
      occurredAt,
      createdBy: actorId,
    });
  }
  purchase.status = STATUS.confirmed;
  purchase.confirmedAt = occurredAt;
  return { purchase, productsById, movements };
}

/**
 * Confirma una venta. Congela precio y costo unitario del momento.
 * No recalcula el costo promedio.
 */
export function applyConfirmedSale({ sale, productsById, actorId, occurredAt }) {
  if (sale.status === STATUS.confirmed) {
    throw new Error("La venta ya está confirmada");
  }
  if (!sale.lines?.length) {
    throw new Error("La venta no tiene líneas");
  }

  const movements = [];
  for (const line of sale.lines) {
    const qty = assertPositiveQty(line.qty);
    const product = productsById[line.productId];
    if (!product) throw new Error("Producto inexistente");
    if (product.stockQty < qty) {
      throw new Error(`Stock insuficiente para ${product.name}: hay ${product.stockQty}, se piden ${qty}`);
    }
    const unitPrice = Number(line.unitPrice ?? product.unitSalePrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("Precio unitario inválido");
    }
    const unitCost = Number(product.avgUnitCost);
    product.stockQty -= qty;
    line.unitPrice = unitPrice;
    line.unitCost = unitCost;
    line.lineRevenue = lineCost(qty, unitPrice);
    line.lineCogs = lineCost(qty, unitCost);
    movements.push({
      productId: product.id,
      movementType: "sale",
      qty: -qty,
      unitCost,
      referenceType: "sale",
      referenceId: sale.id,
      occurredAt,
      createdBy: actorId,
    });
  }
  sale.status = STATUS.confirmed;
  sale.confirmedAt = occurredAt;
  return { sale, productsById, movements };
}

/** Saca el stock restante (merma / producto que no se repondrá). No toca el historial de compras. */
export function applyWriteOff({ product, actorId, occurredAt, reason = "write_off" }) {
  const qty = Number(product.stockQty);
  if (!Number.isInteger(qty) || qty < 0) throw new Error("Stock inválido");
  if (qty === 0) return { product, movement: null };
  const unitCost = Number(product.avgUnitCost);
  product.stockQty = 0;
  return {
    product,
    movement: {
      productId: product.id,
      movementType: "adjustment_out",
      qty: -qty,
      unitCost,
      referenceType: reason,
      referenceId: product.id,
      occurredAt,
      createdBy: actorId,
    },
  };
}

export function summarizeFinance({
  contributions = [],
  purchases = [],
  sales = [],
  expenses = [],
  products = [],
}) {
  const capital = roundTo(
    contributions.reduce((s, c) => s + Number(c.amount), 0),
    2,
  );

  const merchandisePurchased = roundTo(
    purchases
      .filter((p) => p.status === STATUS.confirmed)
      .flatMap((p) => p.lines)
      .reduce((s, l) => s + Number(l.lineCost ?? lineCost(l.qty, l.unitCost)), 0),
    2,
  );

  const confirmedSaleLines = sales
    .filter((p) => p.status === STATUS.confirmed)
    .flatMap((p) => p.lines);

  const salesRevenue = roundTo(
    confirmedSaleLines.reduce((s, l) => s + Number(l.lineRevenue ?? lineCost(l.qty, l.unitPrice)), 0),
    2,
  );

  const cogs = roundTo(
    confirmedSaleLines.reduce((s, l) => s + Number(l.lineCogs ?? lineCost(l.qty, l.unitCost)), 0),
    2,
  );

  const operatingExpenses = roundTo(
    expenses.reduce((s, e) => s + Number(e.amount), 0),
    2,
  );

  const inventoryValue = roundTo(
    products.reduce((s, p) => s + lineCost(p.stockQty, p.avgUnitCost), 0),
    2,
  );

  const grossProfit = roundTo(salesRevenue - cogs, 2);
  const operatingResult = roundTo(grossProfit - operatingExpenses, 2);
  const estimatedCash = roundTo(capital + salesRevenue - merchandisePurchased - operatingExpenses, 2);

  return {
    capital,
    merchandisePurchased,
    cogs,
    inventoryValue,
    salesRevenue,
    grossProfit,
    operatingExpenses,
    operatingResult,
    estimatedCash,
    remainingCapitalAfterPurchases: roundTo(capital - merchandisePurchased, 2),
  };
}
