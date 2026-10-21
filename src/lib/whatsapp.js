export function whatsappLink(phone, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const msg = encodeURIComponent(text);
  return `https://wa.me/${digits}?text=${msg}`;
}
