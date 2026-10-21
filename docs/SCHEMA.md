# Esquema de base de datos

Aplicar con Supabase CLI o pegando `supabase/migrations/20241021120000_init.sql` en el SQL Editor.

Schema `private`: funciones definer (`is_admin`, confirmar compra/venta, registrar gasto/aporte, kardex).
Schema `public`: tablas, vistas invocadoras y wrappers RPC.

## Tablas

### public.admin_users

| Columna | Tipo | Notas |
| --- | --- | --- |
| user_id | uuid PK | `auth.users.id` |
| email | text unique not null | |
| display_name | text not null | |
| created_at | timestamptz | |

### public.categories

id, name unique, slug unique, sort_order.

### public.products

| Columna | Tipo | Notas |
| --- | --- | --- |
| id | uuid | |
| name | text | |
| description | text | |
| category_id | uuid | nullable |
| temu_url | text | |
| list_price_remote | numeric(12,2) | Precio Real Temu (informativo) |
| purchase_lot_cost | numeric(12,2) | último / referencia; el costo vivo es avg_unit_cost |
| unit_sale_price | numeric(14,4) | precio de lista actual |
| stock_qty | integer >= 0 | |
| avg_unit_cost | numeric(14,4) | ponderado; lo actualizan solo las compras |
| is_published | boolean | visible en catálogo si true |
| created_at / updated_at | timestamptz | |

### public.product_images

id, product_id, storage_path, public_url, sort_order.

### public.capital_contributions

id, person_name, amount numeric(12,2), contributed_on date, notes, created_by, created_at.

### public.purchases / purchase_lines

Cabecera: status draft\|confirmed, purchased_on, supplier_notes, confirmed_at.
Líneas: product_id, qty > 0, unit_cost numeric(14,4), line_cost numeric(12,2).

### public.sales / sale_lines

Cabecera: status, sold_on, customer_notes, confirmed_at.
Líneas: product_id, qty > 0, unit_price y unit_cost **copiados al confirmar**, line_revenue, line_cogs.

### public.operating_expenses

id, spent_on, category, amount, notes, created_by.

### public.inventory_movements

Append-only: product_id, movement_type (`purchase`\|`sale`\|`adjustment_in`\|`adjustment_out`), qty, unit_cost, reference_type, reference_id, occurred_at, created_by.

Los ajustes existen en el esquema para auditoría futura; la UI de esta fase no los ofrece porque el Excel no define política de merma.

### public.app_settings

key text PK, value jsonb. Clave `whatsapp_phone`.

## RPC

- `public.confirm_purchase(purchase_id)`
- `public.confirm_sale(sale_id)`
- `public.register_expense(...)`
- `public.register_contribution(...)`

Bloquean el producto con `FOR UPDATE`, rechazan stock insuficiente y no permiten reconfirmar.

## RLS (intención)

- `anon`: SELECT productos con `is_published`; SELECT imágenes de esos productos; SELECT categorías; SELECT `app_settings` solo clave `whatsapp_phone` si se decide exponerla (en esta versión el teléfono público puede ir además en `VITE_WHATSAPP_PHONE`).
- `authenticated` + `private.is_admin()`: SELECT/INSERT/UPDATE en tablas de gestión. Sin DELETE de compras/ventas confirmadas ni de movimientos.
- Storage: lectura pública del bucket; escritura solo admin.
