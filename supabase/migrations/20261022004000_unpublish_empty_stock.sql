create or replace function private.unpublish_if_empty()
returns trigger
language plpgsql
as $$
begin
  if NEW.stock_qty <= 0 then
    NEW.is_published := false;
  end if;
  return NEW;
end;
$$;

drop trigger if exists products_unpublish_empty on public.products;
create trigger products_unpublish_empty
before insert or update of stock_qty on public.products
for each row
execute function private.unpublish_if_empty();
