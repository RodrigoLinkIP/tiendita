# Plan de implementación — Venta Loca

## Arquitectura

```
Navegador (HTML/CSS/JS + Vite)
        │
        ├─ Catálogo público (index.html)
        └─ Panel admin (admin.html) ── Supabase Auth
                │
                ├─ Supabase Postgres (tablas + RPC en schema private)
                └─ Supabase Storage (fotos, bucket product-images)
```

- Dos páginas, módulos ES, sin framework de UI.
- Capa `src/lib/store.js`: elige adaptador Supabase o adaptador local.
- Reglas de inventario y dinero en `src/lib/inventory.js` (las mismas que el SQL, para tests).
- Operaciones que cambian stock o dinero: funciones `private.*` `SECURITY DEFINER` con `search_path` vacío y chequeo `private.is_admin()`. Wrappers `public.*` `SECURITY INVOKER` para el Data API.
- RLS en todas las tablas de `public`. El anónimo solo lee productos publicados e imágenes asociadas.

## Modelo de datos (resumen)

Ver `docs/SCHEMA.md` y `supabase/migrations/`.

- `categories`, `products`, `product_images`
- `admin_users`, `app_settings`
- `capital_contributions`
- `purchases`, `purchase_lines` (estado `draft` | `confirmed`)
- `sales`, `sale_lines` (estado `draft` | `confirmed`)
- `operating_expenses`
- `inventory_movements` (append-only)

Reportes (vista `security_invoker`):

- capital aportado
- mercadería comprada (compras confirmadas)
- mercadería vendida / COGS (líneas de venta confirmadas)
- valor de inventario restante (stock × costo promedio)
- ingresos por ventas
- ganancia bruta = ingresos − COGS
- gastos operativos
- resultado = ganancia bruta − gastos operativos
- efectivo estimado (caja) = capital + ingresos − compras − gastos  
  (supuesto de contado; no es una regla extraída del Excel, se etiqueta como estimado)

## Pantallas

**Público**

- Listado con foto, nombre, precio, categoría, disponibilidad.
- Filtro por categoría.
- Ficha con descripción y botón WhatsApp.

**Admin (sesión requerida)**

- Ingreso / salida.
- Resumen financiero (los renglones de arriba, nunca «ventas − compras» como ganancia).
- Productos (alta, edición, publicación, fotos, precio de lista).
- Compras (borrador → confirmar: entra stock y mueve costo promedio).
- Ventas (borrador → confirmar: sale stock, congela precio y costo).
- Gastos operativos.
- Aportes de capital.
- Kardex / movimientos de inventario.
- Ajustes: teléfono WhatsApp.

## Fases

| Fase | Entrega | Estado |
| --- | --- | --- |
| 0 | Requisitos, plan, esquema, extracto del Excel | Esta iteración |
| 1 | Scaffold Vite, estilos, módulos de dinero/inventario y tests | Esta iteración |
| 2 | Catálogo público + modo local | Esta iteración |
| 3 | Auth y panel: productos, compras, ventas, gastos, capital, reportes | Esta iteración |
| 4 | SQL/RLS/Storage listos para aplicar en Supabase | Esta iteración |
| 5 | Adaptador Supabase, importador opt-in del Excel, docs de despliegue | Esta iteración |
| 6 | Credenciales reales, alta de los 3 usuarios, importación de datos reales | Bloqueado (preguntas 1–10) |

## Qué no se hace todavía

- No se escribe el Excel original.
- No se mezclan datos reales con seeds de prueba.
- No se despliegan secretos.
- No se afirma conexión a un proyecto Supabase hasta tener URL y clave pública.
