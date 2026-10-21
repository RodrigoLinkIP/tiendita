-- Venta Loca schema. Apply in Supabase SQL editor or via CLI.
-- Functions that change money/stock live in schema private (not an exposed API schema).

create schema if not exists private;

create extension if not exists "pgcrypto";

-- ---------- tables ----------
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order int not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category_id uuid references public.categories (id),
  temu_url text,
  list_price_remote numeric(12, 2) not null default 0,
  unit_sale_price numeric(14, 4) not null default 0,
  stock_qty integer not null default 0 check (stock_qty >= 0),
  avg_unit_cost numeric(14, 4) not null default 0 check (avg_unit_cost >= 0),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text,
  public_url text not null,
  sort_order int not null default 0
);

create table public.app_settings (
  key text primary key,
  value jsonb not null
);

create table public.capital_contributions (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  amount numeric(12, 2) not null check (amount > 0),
  contributed_on date not null,
  notes text not null default '',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  purchased_on date not null,
  notes text not null default '',
  confirmed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty integer not null check (qty > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  line_cost numeric(12, 2) generated always as (round(qty * unit_cost, 2)) stored
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  sold_on date not null,
  notes text not null default '',
  confirmed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty integer not null check (qty > 0),
  unit_price numeric(14, 4) check (unit_price >= 0),
  unit_cost numeric(14, 4) check (unit_cost >= 0),
  line_revenue numeric(12, 2),
  line_cogs numeric(12, 2)
);

create table public.operating_expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  category text not null default 'general',
  amount numeric(12, 2) not null check (amount > 0),
  notes text not null default '',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  movement_type text not null check (movement_type in ('purchase', 'sale', 'adjustment_in', 'adjustment_out')),
  qty integer not null,
  unit_cost numeric(14, 4) not null,
  reference_type text,
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

-- ---------- helpers (después de las tablas: language sql resuelve relaciones al crear) ----------
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_admin();
$$;

-- ---------- confirm purchase ----------
create or replace function private.confirm_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  line record;
  v_stock integer;
  v_avg numeric;
  v_new_avg numeric;
begin
  if not private.is_admin() then
    raise exception 'not authorized';
  end if;

  select * into rec
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase not found';
  end if;
  if rec.status = 'confirmed' then
    raise exception 'purchase already confirmed';
  end if;

  for line in
    select * from public.purchase_lines where purchase_id = p_purchase_id
  loop
    select stock_qty, avg_unit_cost into v_stock, v_avg
    from public.products
    where id = line.product_id
    for update;

    if not found then
      raise exception 'product not found';
    end if;

    if v_stock + line.qty = 0 then
      v_new_avg := 0;
    else
      v_new_avg := round(((v_stock * v_avg) + (line.qty * line.unit_cost)) / (v_stock + line.qty), 4);
    end if;

    update public.products
    set stock_qty = v_stock + line.qty,
        avg_unit_cost = v_new_avg,
        updated_at = now()
    where id = line.product_id;

    insert into public.inventory_movements (
      product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by
    ) values (
      line.product_id, 'purchase', line.qty, line.unit_cost, 'purchase', p_purchase_id, auth.uid()
    );
  end loop;

  update public.purchases
  set status = 'confirmed', confirmed_at = now()
  where id = p_purchase_id;
end;
$$;

-- ---------- confirm sale ----------
create or replace function private.confirm_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  line record;
  v_stock integer;
  v_avg numeric;
  v_price numeric;
begin
  if not private.is_admin() then
    raise exception 'not authorized';
  end if;

  select * into rec
  from public.sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'sale not found';
  end if;
  if rec.status = 'confirmed' then
    raise exception 'sale already confirmed';
  end if;

  for line in
    select * from public.sale_lines where sale_id = p_sale_id
  loop
    select stock_qty, avg_unit_cost, unit_sale_price into v_stock, v_avg, v_price
    from public.products
    where id = line.product_id
    for update;

    if not found then
      raise exception 'product not found';
    end if;
    if v_stock < line.qty then
      raise exception 'insufficient stock';
    end if;

    v_price := coalesce(line.unit_price, v_price);

    update public.sale_lines
    set unit_price = v_price,
        unit_cost = v_avg,
        line_revenue = round(line.qty * v_price, 2),
        line_cogs = round(line.qty * v_avg, 2)
    where id = line.id;

    update public.products
    set stock_qty = v_stock - line.qty,
        updated_at = now()
    where id = line.product_id;

    insert into public.inventory_movements (
      product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by
    ) values (
      line.product_id, 'sale', -line.qty, v_avg, 'sale', p_sale_id, auth.uid()
    );
  end loop;

  update public.sales
  set status = 'confirmed', confirmed_at = now()
  where id = p_sale_id;
end;
$$;

create or replace function private.register_expense(
  p_spent_on date,
  p_category text,
  p_amount numeric,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'not authorized';
  end if;
  insert into public.operating_expenses (spent_on, category, amount, notes, created_by)
  values (p_spent_on, coalesce(p_category, 'general'), p_amount, coalesce(p_notes, ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.register_contribution(
  p_person_name text,
  p_amount numeric,
  p_contributed_on date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'not authorized';
  end if;
  insert into public.capital_contributions (person_name, amount, contributed_on, notes, created_by)
  values (p_person_name, p_amount, p_contributed_on, coalesce(p_notes, ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.confirm_purchase(p_purchase_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.confirm_purchase(p_purchase_id);
end;
$$;

create or replace function public.confirm_sale(p_sale_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.confirm_sale(p_sale_id);
end;
$$;

create or replace function public.register_expense(p_spent_on date, p_category text, p_amount numeric, p_notes text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.register_expense(p_spent_on, p_category, p_amount, p_notes);
end;
$$;

create or replace function public.register_contribution(p_person_name text, p_amount numeric, p_contributed_on date, p_notes text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.register_contribution(p_person_name, p_amount, p_contributed_on, p_notes);
end;
$$;

-- Report view: respects RLS of underlying tables (admins see all, public sees zeros/empty).
create or replace view public.finance_report
with (security_invoker = true)
as
select
  coalesce((select sum(amount) from public.capital_contributions), 0) as capital,
  coalesce((
    select sum(pl.line_cost)
    from public.purchase_lines pl
    join public.purchases p on p.id = pl.purchase_id
    where p.status = 'confirmed'
  ), 0) as merchandise_purchased,
  coalesce((
    select sum(sl.line_cogs)
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    where s.status = 'confirmed'
  ), 0) as cogs,
  coalesce((select sum(round(stock_qty * avg_unit_cost, 2)) from public.products), 0) as inventory_value,
  coalesce((
    select sum(sl.line_revenue)
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    where s.status = 'confirmed'
  ), 0) as sales_revenue,
  coalesce((
    select sum(sl.line_revenue) - sum(sl.line_cogs)
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    where s.status = 'confirmed'
  ), 0) as gross_profit,
  coalesce((select sum(amount) from public.operating_expenses), 0) as operating_expenses,
  coalesce((
    select sum(sl.line_revenue) - sum(sl.line_cogs)
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    where s.status = 'confirmed'
  ), 0)
  - coalesce((select sum(amount) from public.operating_expenses), 0) as operating_result,
  coalesce((select sum(amount) from public.capital_contributions), 0)
  + coalesce((
      select sum(sl.line_revenue) from public.sale_lines sl
      join public.sales s on s.id = sl.sale_id where s.status = 'confirmed'
    ), 0)
  - coalesce((
      select sum(pl.line_cost) from public.purchase_lines pl
      join public.purchases p on p.id = pl.purchase_id where p.status = 'confirmed'
    ), 0)
  - coalesce((select sum(amount) from public.operating_expenses), 0) as estimated_cash,
  coalesce((select sum(amount) from public.capital_contributions), 0)
  - coalesce((
      select sum(pl.line_cost) from public.purchase_lines pl
      join public.purchases p on p.id = pl.purchase_id where p.status = 'confirmed'
    ), 0) as remaining_capital_after_purchases;

-- ---------- grants / RLS ----------
revoke all on schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated;

alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.app_settings enable row level security;
alter table public.capital_contributions enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.operating_expenses enable row level security;
alter table public.inventory_movements enable row level security;

grant select on public.categories to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.product_images to anon, authenticated;
grant select on public.app_settings to anon, authenticated;

grant select on public.admin_users to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update, delete on public.product_images to authenticated;
grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.app_settings to authenticated;
grant select, insert on public.capital_contributions to authenticated;
grant select, insert, update on public.purchases to authenticated;
grant select, insert, update, delete on public.purchase_lines to authenticated;
grant select, insert, update on public.sales to authenticated;
grant select, insert, update, delete on public.sale_lines to authenticated;
grant select, insert on public.operating_expenses to authenticated;
grant select, insert on public.inventory_movements to authenticated;
grant select on public.finance_report to authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.confirm_purchase(uuid) to authenticated;
grant execute on function public.confirm_sale(uuid) to authenticated;
grant execute on function public.register_expense(date, text, numeric, text) to authenticated;
grant execute on function public.register_contribution(text, numeric, date, text) to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.confirm_purchase(uuid) to authenticated;
grant execute on function private.confirm_sale(uuid) to authenticated;
grant execute on function private.register_expense(date, text, numeric, text) to authenticated;
grant execute on function private.register_contribution(text, numeric, date, text) to authenticated;

create policy categories_public_read on public.categories
  for select to anon, authenticated using (true);

create policy categories_admin_write on public.categories
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy products_public_read on public.products
  for select to anon, authenticated
  using (is_published = true or private.is_admin());

create policy products_admin_write on public.products
  for insert to authenticated with check (private.is_admin());

create policy products_admin_update on public.products
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

create policy images_public_read on public.product_images
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id and (p.is_published = true or private.is_admin())
    )
  );

create policy images_admin_write on public.product_images
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy settings_read_whatsapp on public.app_settings
  for select to anon, authenticated
  using (key = 'whatsapp_phone' or private.is_admin());

create policy settings_admin_write on public.app_settings
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy admin_users_self_or_admin on public.admin_users
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

create policy capital_admin on public.capital_contributions
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy purchases_admin on public.purchases
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy purchase_lines_admin on public.purchase_lines
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy sales_admin on public.sales
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy sale_lines_admin on public.sale_lines
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy expenses_admin on public.operating_expenses
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy movements_admin_select on public.inventory_movements
  for select to authenticated using (private.is_admin());

create policy movements_admin_insert on public.inventory_movements
  for insert to authenticated with check (private.is_admin());

-- Prevent deleting confirmed documents via API: handled in UI; drafts may be updated.
-- No DELETE policies for purchases/sales/movements/contributions/expenses.

insert into public.categories (name, slug, sort_order) values
  ('Stickers', 'stickers', 1),
  ('Pines', 'pines', 2),
  ('Ganchos', 'ganchos', 3),
  ('Figuras', 'figuras', 4),
  ('Espejos', 'espejos', 5),
  ('Otros', 'otros', 6)
on conflict (name) do nothing;

-- Storage bucket (run in dashboard if this fails without storage schema privileges)
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy storage_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

create policy storage_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and private.is_admin());

create policy storage_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and private.is_admin())
  with check (bucket_id = 'product-images' and private.is_admin());
