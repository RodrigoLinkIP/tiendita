-- Presentación de venta (paquete vs unidad), disponibilidad pública, archivo y 3 WhatsApp.

alter table public.products
  add column if not exists sell_mode text not null default 'unit',
  add column if not exists pack_qty integer not null default 1,
  add column if not exists pack_price numeric(14, 4) not null default 0,
  add column if not exists availability_display text not null default 'count',
  add column if not exists archived_at timestamptz;

alter table public.products drop constraint if exists products_sell_mode_check;
alter table public.products add constraint products_sell_mode_check
  check (sell_mode in ('unit', 'pack'));

alter table public.products drop constraint if exists products_pack_qty_check;
alter table public.products add constraint products_pack_qty_check
  check (pack_qty > 0);

alter table public.products drop constraint if exists products_availability_display_check;
alter table public.products add constraint products_availability_display_check
  check (availability_display in ('count', 'subject'));

update public.products
set sell_mode = 'pack', pack_qty = 2, pack_price = round(unit_sale_price * 2, 4)
where unit_sale_price > 0 and unit_sale_price <= 0.15 and sell_mode = 'unit';

update public.products p
set availability_display = 'subject'
from public.categories c
where p.category_id = c.id and c.slug = 'stickers';

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (
    (is_published = true and archived_at is null)
    or private.is_admin()
  );

drop policy if exists settings_read_whatsapp on public.app_settings;
create policy settings_read_whatsapp on public.app_settings
  for select to anon, authenticated
  using (key in ('whatsapp_phone', 'whatsapp_phones') or private.is_admin());

create or replace function private.write_off_stock(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  if not private.is_admin() then
    raise exception 'not authorized';
  end if;
  select * into rec from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found';
  end if;
  if rec.stock_qty = 0 then
    return;
  end if;
  insert into public.inventory_movements (
    product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by
  ) values (
    rec.id, 'adjustment_out', -rec.stock_qty, rec.avg_unit_cost, 'write_off', rec.id, auth.uid()
  );
  update public.products
  set stock_qty = 0, updated_at = now()
  where id = rec.id;
end;
$$;

create or replace function private.archive_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not authorized';
  end if;
  perform private.write_off_stock(p_product_id);
  update public.products
  set is_published = false, archived_at = now(), updated_at = now()
  where id = p_product_id;
end;
$$;

create or replace function public.write_off_stock(p_product_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.write_off_stock(p_product_id);
end;
$$;

create or replace function public.archive_product(p_product_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.archive_product(p_product_id);
end;
$$;

grant execute on function public.write_off_stock(uuid) to authenticated;
grant execute on function public.archive_product(uuid) to authenticated;
grant execute on function private.write_off_stock(uuid) to authenticated;
grant execute on function private.archive_product(uuid) to authenticated;
