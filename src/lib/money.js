/** Importes de línea y totales: 2 decimales (céntimos). Precios unitarios: 4 decimales. */

export function roundTo(value, decimals) {
  const f = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * f) / f;
}

export function toCents(value) {
  return Math.round(Number(value) * 100);
}

export function fromCents(cents) {
  return roundTo(Number(cents) / 100, 2);
}

export function toUnitScaled(value) {
  return Math.round(Number(value) * 10000);
}

export function fromUnitScaled(scaled) {
  return roundTo(Number(scaled) / 10000, 4);
}

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function unitMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function lineCost(qty, unitCost) {
  return roundTo(Number(qty) * Number(unitCost), 2);
}
