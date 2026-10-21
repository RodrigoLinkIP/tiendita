-- Carga inicial idempotente (venta_loca). Ejecutar como postgres / SQL Editor.
-- No crea ventas. Tablero = gasto, no stock.

do $$
declare
  v_rodri uuid := '1f462255-5465-4867-bf6d-305435e8db84';
  v_purchase uuid;
  r record;
begin
  if exists (select 1 from public.products) then
    raise notice 'seed skipped: products already present';
    return;
  end if;

  insert into public.app_settings (key, value)
  values
    ('currency', '{"code":"USD"}'::jsonb),
    ('whatsapp_phone', '{"phone":""}'::jsonb)
  on conflict (key) do nothing;

  insert into public.capital_contributions (person_name, amount, contributed_on, notes, created_by)
  values
    ('Vero', 15, '2026-10-01', 'Aporte inicial Excel', v_rodri),
    ('Rodri', 15, '2026-10-01', 'Aporte inicial Excel', v_rodri),
    ('Sofi', 15, '2026-10-01', 'Aporte inicial Excel', v_rodri);

  insert into public.operating_expenses (spent_on, category, amount, notes, created_by)
  values ('2026-10-01', 'exhibicion', 3.19, 'Tablero de exhibición para pins (no se vende)', v_rodri);

  insert into public.purchases (id, status, purchased_on, notes, created_by)
  values (gen_random_uuid(), 'draft', '2026-10-01', 'Carga inicial Precio Promo / lotes Excel', v_rodri)
  returning id into v_purchase;

  create temporary table seed_lots (
    name text,
    description text,
    temu_url text,
    category_slug text,
    list_price_remote numeric,
    unit_sale_price numeric,
    qty integer,
    lot_cost numeric
  ) on commit drop;

  insert into seed_lots values
    ('Stickers de gatitos', 'Stickers de gatitos', 'https://share.temu.com/cu8qqSBFIYA', 'stickers', 2.23, 0.125, 54, 1.18),
    ('100 stickers de One Piece', '100 stickers de One Piece', 'https://share.temu.com/axroOKw88OA', 'stickers', 8.04, 0.0625, 100, 3.82),
    ('16 piezas de ganchos', '16 piezas de ganchos', 'https://share.temu.com/7Yh2plG9GEA', 'ganchos', 13.66, 0.6, 16, 6.84),
    ('6 pines Snoopy Haweleen', '6 pines Snoopy Haweleen', 'https://share.temu.com/dVqxbNihI3A', 'pines', 6.64, 1.25, 6, 3.33),
    ('22 pcs ganchitos Y2K', '22 pcs ganchitos Y2K', 'https://share.temu.com/dVqxbNihI3A', 'ganchos', 2.69, 0.15, 22, 1.6),
    ('50 Stickers de JJK', '50 Stickers de JJK', 'https://share.temu.com/IhMBhgKbbWA', 'stickers', 3.2, 0.125, 50, 1.63),
    ('100 stickers de stitch', '100 stickers de stitch (lote 101 uds.)', 'https://share.temu.com/8PHicFRZibA', 'stickers', 2.48, 0.083, 101, 1.32),
    ('7 figuritas de Harry Potter', '7 figuritas de Harry Potter', 'https://share.temu.com/lsOoULiehMA', 'figuras', 7.51, 1, 7, 3.89),
    ('2 squishy del maje amarrillo', '2 squishy del maje amarrillo', 'https://share.temu.com/DJnrgHfTfWA', 'figuras', 5.23, 2, 2, 2.77),
    ('Juego de 6 Marcadores Florales', 'Juego de 6 Marcadores Florales', 'https://share.temu.com/9DrVXLOoPYA', 'otros', 5.03, 0.6, 6, 2.67),
    ('70 stickers de Minecraft', '70 stickers de Minecraft', 'https://share.temu.com/7nrT1hz3JjA', 'stickers', 2.81, 0.125, 70, 1.65),
    ('51 stickers Hello K.', '51 stickers Hello K. (lote 50 uds.)', 'https://share.temu.com/gA5YQVq8b6A', 'stickers', 2.62, 0.125, 50, 1.34),
    ('50 Stickers estilo pinterest', '50 Stickers estilo pinterest', 'https://share.temu.com/xd8NPTaYEWA', 'stickers', 2.74, 0.125, 50, 1.41),
    ('50 stickers de chainsaw man', '50 stickers de chainsaw man', 'https://share.temu.com/p2H6Xr4KYoA', 'stickers', 3.57, 0.125, 50, 1.75);

  for r in select * from seed_lots
  loop
    insert into public.products (
      name, description, category_id, temu_url, list_price_remote, unit_sale_price, stock_qty, avg_unit_cost, is_published
    )
    select
      r.name,
      r.description,
      c.id,
      r.temu_url,
      r.list_price_remote,
      r.unit_sale_price,
      0,
      0,
      true
    from public.categories c
    where c.slug = r.category_slug;

    insert into public.purchase_lines (purchase_id, product_id, qty, unit_cost)
    select v_purchase, p.id, r.qty, round(r.lot_cost / r.qty, 4)
    from public.products p
    where p.name = r.name;
  end loop;

  -- Replica private.confirm_purchase sin auth.uid() (carga hecha por postgres).
  for r in
    select pl.product_id, pl.qty, pl.unit_cost
    from public.purchase_lines pl
    where pl.purchase_id = v_purchase
  loop
    update public.products p
    set
      avg_unit_cost = case
        when p.stock_qty + r.qty = 0 then 0
        else round(((p.stock_qty * p.avg_unit_cost) + (r.qty * r.unit_cost)) / (p.stock_qty + r.qty), 4)
      end,
      stock_qty = p.stock_qty + r.qty,
      updated_at = now()
    where p.id = r.product_id;

    insert into public.inventory_movements (
      product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by
    ) values (
      r.product_id, 'purchase', r.qty, r.unit_cost, 'purchase', v_purchase, v_rodri
    );
  end loop;

  update public.purchases
  set status = 'confirmed', confirmed_at = now()
  where id = v_purchase;
end $$;
