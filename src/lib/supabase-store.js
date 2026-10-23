import { getSupabase } from "./supabase-client.js";
import { impliedUnitPrice, normalizePhones } from "./offer.js";

function mapProduct(row, images = []) {
  const sorted = [...(images || [])].sort((a, b) => a.sort_order - b.sort_order);
  const image = sorted[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.categories?.name || "Sin categoría",
    temuUrl: row.temu_url,
    listPriceRemote: Number(row.list_price_remote || 0),
    remotePackQty: Math.max(1, Number(row.remote_pack_qty || 1)),
    unitSalePrice: Number(row.unit_sale_price || 0),
    sellMode: row.sell_mode || "unit",
    packQty: Number(row.pack_qty || 1),
    packPrice: Number(row.pack_price || 0),
    availabilityDisplay: row.availability_display || "count",
    archivedAt: row.archived_at || null,
    stockQty: row.stock_qty,
    avgUnitCost: Number(row.avg_unit_cost || 0),
    isPublished: row.is_published,
    imageUrl: image?.public_url || "",
    images: sorted.map((img) => ({ id: img.id, url: img.public_url, sortOrder: img.sort_order })),
    available: row.stock_qty > 0,
  };
}

export function createSupabaseStore() {
  const sb = getSupabase();
  if (!sb) throw new Error("Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY");

  return {
    mode: "supabase",

    async getSession() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      const { data: admin, error } = await sb
        .from("admin_users")
        .select("display_name, email")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!admin) return { userId: user.id, email: user.email, displayName: user.email, unauthorized: true };
      return { userId: user.id, email: admin.email, displayName: admin.display_name };
    },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return this.getSession();
    },

    async requestPasswordReset(email) {
      const redirectTo = `${window.location.origin}/admin.html`;
      const { error } = await sb.auth.resetPasswordForEmail(String(email || "").trim(), { redirectTo });
      if (error) throw error;
    },

    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async listCategories() {
      const { data, error } = await sb.from("categories").select("*").order("sort_order");
      if (error) throw error;
      return data.map((c) => ({ id: c.id, name: c.name, slug: c.slug, sortOrder: c.sort_order }));
    },

    async listPublishedProducts() {
      const { data, error } = await sb
        .from("products")
        .select("*, categories(name), product_images(id, public_url, sort_order)")
        .eq("is_published", true)
        .is("archived_at", null)
        .order("name");
      if (error) throw error;
      return data.map((row) => mapProduct(row, row.product_images));
    },

    async getWhatsappPhones() {
      const envPhone = import.meta.env.VITE_WHATSAPP_PHONE || "";
      const { data, error } = await sb.from("app_settings").select("key, value").in("key", ["whatsapp_phones", "whatsapp_phone"]);
      if (error) return normalizePhones([], envPhone);
      const multi = data?.find((r) => r.key === "whatsapp_phones")?.value;
      const one = data?.find((r) => r.key === "whatsapp_phone")?.value?.phone;
      if (Array.isArray(multi?.phones)) return normalizePhones(multi.phones, envPhone);
      if (Array.isArray(multi)) return normalizePhones(multi, envPhone);
      return normalizePhones([], one || envPhone);
    },

    async getWhatsappPhone() {
      const phones = await this.getWhatsappPhones();
      return phones.find((p) => p.phone)?.phone || "";
    },

    async listAllProducts() {
      const { data, error } = await sb
        .from("products")
        .select("*, categories(name), product_images(id, public_url, sort_order)")
        .order("name");
      if (error) throw error;
      return data.map((row) => mapProduct(row, row.product_images));
    },

    async saveProduct(input) {
      const payload = {
        name: input.name.trim(),
        description: input.description || "",
        category_id: input.categoryId || null,
        unit_sale_price: input.sellMode === "pack" ? impliedUnitPrice(input) : input.unitSalePrice || 0,
        sell_mode: input.sellMode === "pack" ? "pack" : "unit",
        pack_qty: input.sellMode === "pack" ? Math.max(2, Number(input.packQty || 2)) : 1,
        pack_price: input.sellMode === "pack" ? Number(input.packPrice || 0) : 0,
        availability_display: input.availabilityDisplay === "subject" ? "subject" : "count",
        is_published: Boolean(input.isPublished),
        archived_at: input.archivedAt || null,
      };
      if (input.temuUrl !== undefined) payload.temu_url = input.temuUrl || "";
      if (input.listPriceRemote !== undefined) payload.list_price_remote = input.listPriceRemote || 0;
      if (input.remotePackQty !== undefined) payload.remote_pack_qty = Math.max(1, Math.floor(Number(input.remotePackQty || 1)));
      if (input.stockQty !== undefined) payload.stock_qty = Math.max(0, Math.floor(Number(input.stockQty || 0)));
      if (input.avgUnitCost !== undefined) payload.avg_unit_cost = Math.max(0, Number(input.avgUnitCost || 0));
      let row;
      if (input.id) {
        const { data, error } = await sb.from("products").update(payload).eq("id", input.id).select().single();
        if (error) throw error;
        row = data;
      } else {
        const { data, error } = await sb.from("products").insert(payload).select().single();
        if (error) throw error;
        row = data;
      }
      const files = [...(input.imageFiles || [])].filter((f) => f && f.size);
      if (files.length) {
        const { data: existing } = await sb
          .from("product_images")
          .select("sort_order")
          .eq("product_id", row.id)
          .order("sort_order", { ascending: false })
          .limit(1);
        let order = Number(existing?.[0]?.sort_order ?? -1) + 1;
        for (const file of files) {
          const path = `${row.id}/${Date.now()}-${order}-${file.name}`;
          const { error: upErr } = await sb.storage.from("product-images").upload(path, file);
          if (upErr) throw upErr;
          const { data: pub } = sb.storage.from("product-images").getPublicUrl(path);
          const { error: imgErr } = await sb.from("product_images").insert({
            product_id: row.id,
            storage_path: path,
            public_url: pub.publicUrl,
            sort_order: order,
          });
          if (imgErr) throw imgErr;
          order += 1;
        }
      }
      const extraUrls = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
      if (extraUrls.length) {
        const { data: existing } = await sb
          .from("product_images")
          .select("sort_order")
          .eq("product_id", row.id)
          .order("sort_order", { ascending: false })
          .limit(1);
        let order = Number(existing?.[0]?.sort_order ?? -1) + 1;
        const { error: imgErr } = await sb.from("product_images").insert(
          extraUrls.map((url) => ({
            product_id: row.id,
            storage_path: null,
            public_url: String(url).trim(),
            sort_order: order++,
          })),
        );
        if (imgErr) throw imgErr;
      }
      const { data: imgs } = await sb.from("product_images").select("id, public_url, sort_order").eq("product_id", row.id);
      return mapProduct(row, imgs || []);
    },

    async removeProductImage(imageId) {
      const { error } = await sb.from("product_images").delete().eq("id", imageId);
      if (error) throw error;
    },

    async createPurchaseDraft({ purchasedOn, notes, lines }) {
      const { data: header, error } = await sb
        .from("purchases")
        .insert({ purchased_on: purchasedOn, notes, status: "draft" })
        .select()
        .single();
      if (error) throw error;
      const { error: lineErr } = await sb.from("purchase_lines").insert(
        lines.map((l) => ({
          purchase_id: header.id,
          product_id: l.productId,
          qty: l.qty,
          unit_cost: l.unitCost,
        })),
      );
      if (lineErr) throw lineErr;
      return { id: header.id };
    },

    async confirmPurchase(purchaseId) {
      const { error } = await sb.rpc("confirm_purchase", { p_purchase_id: purchaseId });
      if (error) throw error;
    },

    async createSaleDraft({ soldOn, notes, lines }) {
      const { data: header, error } = await sb
        .from("sales")
        .insert({ sold_on: soldOn, notes, status: "draft" })
        .select()
        .single();
      if (error) throw error;
      const { error: lineErr } = await sb.from("sale_lines").insert(
        lines.map((l) => ({
          sale_id: header.id,
          product_id: l.productId,
          qty: l.qty,
          unit_price: l.unitPrice,
        })),
      );
      if (lineErr) throw lineErr;
      return { id: header.id };
    },

    async confirmSale(saleId) {
      const { error } = await sb.rpc("confirm_sale", { p_sale_id: saleId });
      if (error) throw error;
    },

    async saveSale(input) {
      const { data, error } = await sb.rpc("save_sale", {
        p_payload: {
          id: input.id || null,
          status: input.status,
          sold_on: input.soldOn,
          notes: input.notes || "",
          lines: (input.lines || []).map((l) => ({
            product_id: l.productId,
            qty: Number(l.qty),
            unit_price: Number(l.unitPrice),
          })),
        },
      });
      if (error) throw error;
      return { id: data };
    },

    async registerExpense(input) {
      const { error } = await sb.rpc("register_expense", {
        p_spent_on: input.spentOn,
        p_category: input.category,
        p_amount: input.amount,
        p_notes: input.notes || "",
      });
      if (error) throw error;
    },

    async registerContribution(input) {
      const { error } = await sb.rpc("register_contribution", {
        p_person_name: input.personName,
        p_amount: input.amount,
        p_contributed_on: input.contributedOn,
        p_notes: input.notes || "",
      });
      if (error) throw error;
    },

    async setWhatsappPhones(phones) {
      const rows = normalizePhones(phones);
      const { error } = await sb.from("app_settings").upsert({ key: "whatsapp_phones", value: { phones: rows } });
      if (error) throw error;
      const first = rows.find((p) => p.phone)?.phone || "";
      await sb.from("app_settings").upsert({ key: "whatsapp_phone", value: { phone: first } });
    },

    async setWhatsappPhone(phone) {
      await this.setWhatsappPhones([{ label: "WhatsApp", phone }]);
    },

    async writeOffStock(productId) {
      const { error } = await sb.rpc("write_off_stock", { p_product_id: productId });
      if (error) throw error;
    },

    async archiveProduct(productId) {
      const { error } = await sb.rpc("archive_product", { p_product_id: productId });
      if (error) throw error;
    },

    async listPurchases() {
      const { data, error } = await sb
        .from("purchases")
        .select("*, purchase_lines(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map((p) => ({
        id: p.id,
        status: p.status,
        purchasedOn: p.purchased_on,
        notes: p.notes,
        lines: p.purchase_lines.map((l) => ({
          id: l.id,
          productId: l.product_id,
          qty: l.qty,
          unitCost: Number(l.unit_cost),
          lineCost: Number(l.line_cost || 0),
        })),
      }));
    },

    async listSales() {
      const { data, error } = await sb.from("sales").select("*, sale_lines(*)").order("created_at", { ascending: false });
      if (error) throw error;
      return data.map((p) => ({
        id: p.id,
        status: p.status,
        soldOn: p.sold_on,
        notes: p.notes,
        lines: p.sale_lines.map((l) => ({
          id: l.id,
          productId: l.product_id,
          qty: l.qty,
          unitPrice: Number(l.unit_price || 0),
          unitCost: Number(l.unit_cost || 0),
          lineRevenue: Number(l.line_revenue || 0),
          lineCogs: Number(l.line_cogs || 0),
        })),
      }));
    },

    async listExpenses() {
      const { data, error } = await sb.from("operating_expenses").select("*").order("spent_on", { ascending: false });
      if (error) throw error;
      return data.map((e) => ({
        id: e.id,
        spentOn: e.spent_on,
        category: e.category,
        amount: Number(e.amount),
        notes: e.notes,
      }));
    },

    async listContributions() {
      const { data, error } = await sb
        .from("capital_contributions")
        .select("*")
        .order("contributed_on", { ascending: false });
      if (error) throw error;
      return data.map((e) => ({
        id: e.id,
        personName: e.person_name,
        amount: Number(e.amount),
        contributedOn: e.contributed_on,
        notes: e.notes,
      }));
    },

    async listMovements() {
      const { data, error } = await sb
        .from("inventory_movements")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data.map((m) => ({
        productId: m.product_id,
        movementType: m.movement_type,
        qty: m.qty,
        unitCost: Number(m.unit_cost),
        referenceType: m.reference_type,
        referenceId: m.reference_id,
        occurredAt: m.occurred_at,
      }));
    },

    async report() {
      const { data, error } = await sb.from("finance_report").select("*").single();
      if (error) throw error;
      return {
        capital: Number(data.capital),
        merchandisePurchased: Number(data.merchandise_purchased),
        cogs: Number(data.cogs),
        inventoryValue: Number(data.inventory_value),
        salesRevenue: Number(data.sales_revenue),
        grossProfit: Number(data.gross_profit),
        operatingExpenses: Number(data.operating_expenses),
        operatingResult: Number(data.operating_result),
        estimatedCash: Number(data.estimated_cash),
        remainingCapitalAfterPurchases: Number(data.remaining_capital_after_purchases),
      };
    },
  };
}
