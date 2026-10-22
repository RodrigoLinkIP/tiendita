alter table public.products
  add column if not exists remote_pack_qty integer not null default 1 check (remote_pack_qty >= 1);
