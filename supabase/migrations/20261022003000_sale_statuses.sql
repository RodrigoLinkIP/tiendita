alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales
  add constraint sales_status_check
  check (status in ('draft', 'confirmed', 'reserved', 'sold', 'cancelled'));

update public.sales set status = 'sold' where status = 'confirmed';

create or replace function private.save_sale(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  rec record;
  old_line record;
  line jsonb;
  v_status text;
  v_old_status text;
  v_holds_old boolean;
  v_holds_new boolean;
  v_product uuid;
  v_qty integer;
  v_price numeric;
  v_stock integer;
  v_avg numeric;
begin
  if not private.is_admin() then
    raise exception 'not authorized';
  end if;

  v_status := p_payload->>'status';
  if v_status not in ('reserved', 'sold', 'cancelled') then
    raise exception 'invalid sale status';
  end if;

  v_holds_new := v_status in ('reserved', 'sold');
  v_id := nullif(p_payload->>'id', '')::uuid;

  if v_id is not null then
    select * into rec from public.sales where id = v_id for update;
    if not found then
      raise exception 'sale not found';
    end if;
    v_old_status := rec.status;
    v_holds_old := v_old_status in ('reserved', 'sold', 'confirmed');

    if v_holds_old then
      for old_line in select * from public.sale_lines where sale_id = v_id
      loop
        update public.products
        set stock_qty = stock_qty + old_line.qty, updated_at = now()
        where id = old_line.product_id;
        insert into public.inventory_movements (
          product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by
        ) values (
          old_line.product_id, 'adjustment_in', old_line.qty, coalesce(old_line.unit_cost, 0), 'sale', v_id, auth.uid()
        );
      end loop;
    end if;

    update public.sales
    set status = v_status,
        sold_on = (p_payload->>'sold_on')::date,
        notes = coalesce(p_payload->>'notes', ''),
        confirmed_at = case when v_status = 'sold' then now() else rec.confirmed_at end
    where id = v_id;

    delete from public.sale_lines where sale_id = v_id;
  else
    insert into public.sales (status, sold_on, notes, created_by, confirmed_at)
    values (
      v_status,
      (p_payload->>'sold_on')::date,
      coalesce(p_payload->>'notes', ''),
      auth.uid(),
      case when v_status = 'sold' then now() else null end
    )
    returning id into v_id;
  end if;

  for line in select jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_product := (line->>'product_id')::uuid;
    v_qty := (line->>'qty')::integer;
    v_price := coalesce((line->>'unit_price')::numeric, 0);
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid qty';
    end if;

    select stock_qty, avg_unit_cost into v_stock, v_avg
    from public.products
    where id = v_product
    for update;
    if not found then
      raise exception 'product not found';
    end if;

    insert into public.sale_lines (
      sale_id, product_id, qty, unit_price, unit_cost, line_revenue, line_cogs
    ) values (
      v_id, v_product, v_qty, v_price, v_avg, round(v_qty * v_price, 2), round(v_qty * v_avg, 2)
    );

    if v_holds_new then
      if v_stock < v_qty then
        raise exception 'insufficient stock';
      end if;
      update public.products
      set stock_qty = v_stock - v_qty, updated_at = now()
      where id = v_product;
      insert into public.inventory_movements (
        product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by
      ) values (
        v_product, 'sale', -v_qty, v_avg, 'sale', v_id, auth.uid()
      );
    end if;
  end loop;

  return v_id;
end;
$$;

create or replace function public.save_sale(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.save_sale(p_payload);
end;
$$;

grant execute on function public.save_sale(jsonb) to authenticated;
grant execute on function private.save_sale(jsonb) to authenticated;

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
    where s.status in ('sold', 'confirmed')
  ), 0) as cogs,
  coalesce((select sum(round(stock_qty * avg_unit_cost, 2)) from public.products), 0) as inventory_value,
  coalesce((
    select sum(sl.line_revenue)
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    where s.status in ('sold', 'confirmed')
  ), 0) as sales_revenue,
  coalesce((
    select sum(sl.line_revenue) - sum(sl.line_cogs)
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    where s.status in ('sold', 'confirmed')
  ), 0) as gross_profit,
  coalesce((select sum(amount) from public.operating_expenses), 0) as operating_expenses,
  coalesce((
    select sum(sl.line_revenue) - sum(sl.line_cogs)
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    where s.status in ('sold', 'confirmed')
  ), 0)
  - coalesce((select sum(amount) from public.operating_expenses), 0) as operating_result,
  coalesce((select sum(amount) from public.capital_contributions), 0)
  + coalesce((
      select sum(sl.line_revenue) from public.sale_lines sl
      join public.sales s on s.id = sl.sale_id where s.status in ('sold', 'confirmed')
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

grant select on public.finance_report to authenticated;
