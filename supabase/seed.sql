-- Datos FICTICIOS para pruebas. No corresponden al Excel real.
-- Ejecutar solo en un proyecto de desarrollo.

insert into public.products (name, description, unit_sale_price, stock_qty, avg_unit_cost, is_published, category_id)
select
  'Stickers de prueba',
  'Producto ficticio para verificar el catálogo.',
  0.1500,
  10,
  0.0400,
  true,
  id
from public.categories
where slug = 'stickers'
limit 1;
