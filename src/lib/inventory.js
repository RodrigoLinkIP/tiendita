import { lineCost, roundTo } from "./money.js";

export const STATUS = {
  draft: "draft",
  confirmed: "confirmed",
  reserved: "reserved",
  sold: "sold",
  cancelled: "cancelled",
};

export function saleHoldsStock(status) {
  return status === STATUS.reserved || status === STATUS.sold || status === STATUS.confirmed;
}

export function saleCountsRevenue(status) {
  return status === STATUS.sold || status === STATUS.confirmed;
}

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
    if (product.stockQty <= 0) product.isPublished = false;
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

/**
 * Crea o actualiza una venta y ajusta stock:
 * comprada/apartada descuenta; cancelada devuelve.
 */
export function applySaleUpdate({ sale, productsById, patch, actorId, occurredAt }) {
  const nextStatus = patch.status;
  if (![STATUS.reserved, STATUS.sold, STATUS.cancelled].includes(nextStatus)) {
    throw new Error("Estado de venta inválido");
  }
  if (!patch.lines?.length) throw new Error("La venta no tiene líneas");

  const movements = [];
  const prevStatus = sale.status;
  const prevLines = [...(sale.lines || [])];

  if (saleHoldsStock(prevStatus)) {
    for (const line of prevLines) {
      const product = productsById[line.productId];
      if (!product) throw new Error("Producto inexistente");
      const qty = Number(line.qty);
      product.stockQty += qty;
      movements.push({
        productId: product.id,
        movementType: "adjustment_in",
        qty,
        unitCost: Number(line.unitCost || product.avgUnitCost || 0),
        referenceType: "sale",
        referenceId: sale.id,
        occurredAt,
        createdBy: actorId,
      });
    }
  }

  const nextLines = [];
  for (const raw of patch.lines) {
    const qty = assertPositiveQty(raw.qty);
    const product = productsById[raw.productId];
    if (!product) throw new Error("Producto inexistente");
    const unitPrice = Number(raw.unitPrice ?? product.unitSalePrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("Precio unitario inválido");
    }
    const unitCost = Number(product.avgUnitCost);
    nextLines.push({
      id: raw.id,
      productId: product.id,
      qty,
      unitPrice,
      unitCost,
      lineRevenue: lineCost(qty, unitPrice),
      lineCogs: lineCost(qty, unitCost),
    });
  }

  if (saleHoldsStock(nextStatus)) {
    for (const line of nextLines) {
      const product = productsById[line.productId];
      if (product.stockQty < line.qty) {
        throw new Error(`Stock insuficiente para ${product.name}: hay ${product.stockQty}, se piden ${line.qty}`);
      }
      product.stockQty -= line.qty;
      if (product.stockQty <= 0) product.isPublished = false;
      movements.push({
        productId: product.id,
        movementType: "sale",
        qty: -line.qty,
        unitCost: line.unitCost,
        referenceType: "sale",
        referenceId: sale.id,
        occurredAt,
        createdBy: actorId,
      });
    }
  }

  sale.status = nextStatus;
  sale.soldOn = patch.soldOn ?? sale.soldOn;
  sale.notes = patch.notes ?? sale.notes;
  sale.lines = nextLines;
  if (nextStatus === STATUS.sold) sale.confirmedAt = occurredAt;
  return { sale, productsById, movements };
}

/** Saca el stock restante (merma / producto que no se repondrá). No toca el historial de compras. */
export function applyWriteOff({ product, actorId, occurredAt, reason = "write_off" }) {
  const qty = Number(product.stockQty);
  if (!Number.isInteger(qty) || qty < 0) throw new Error("Stock inválido");
  if (qty === 0) return { product, movement: null };
  const unitCost = Number(product.avgUnitCost);
  product.stockQty = 0;
  product.isPublished = false;
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
    .filter((p) => saleCountsRevenue(p.status))
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
