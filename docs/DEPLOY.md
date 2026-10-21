# Configuración y despliegue

## Variables

Copiar `.env.example` a `.env.local`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (anon / publishable, **nunca** `service_role`)
- `VITE_WHATSAPP_PHONE` (solo dígitos, con código de país)
- `VITE_LOCAL_MODE=true` para trabajar sin proyecto Supabase

En Vercel, las mismas variables `VITE_*`.

## Base de datos

1. Crear proyecto Supabase.
2. Authentication → Enable Email.
3. Crear los 3 usuarios (Vero, Rodri, Sofi) y copiar sus UUID.
4. SQL Editor: ejecutar **todo** el archivo `supabase/migrations/20241021120000_init.sql` de una vez (las funciones van **después** de las tablas). Si un intento anterior falló con `admin_users does not exist`, vuelve a pegar el archivo actualizado; `CREATE SCHEMA IF NOT EXISTS` es seguro.
5. Insertar administradores (reemplazar UUID y correos reales):

```sql
insert into public.admin_users (user_id, email, display_name)
values
  ('00000000-0000-0000-0000-000000000001', 'vero@example.com', 'Vero'),
  ('00000000-0000-0000-0000-000000000002', 'rodri@example.com', 'Rodri'),
  ('00000000-0000-0000-0000-000000000003', 'sofi@example.com', 'Sofi');
```

6. Settings → API: confirmar que el schema `private` **no** está en Exposed schemas.
7. `supabase/seed.sql` es solo ficticio; no usarlo en producción.

## Storage

El migration intenta crear el bucket `product-images` público. Si falla por permisos, créalo a mano con las políticas del mismo archivo.

## Vercel

```bash
npm run build
```

Root del proyecto Vite: salida `dist/`. Framework preset: Vite. Rewrite `/admin` → `/admin.html` (`vercel.json`).

## Importar el Excel

No hay importación automática a producción. El extracto está en `data/excel-extract/`. Cuando se confirmen las preguntas de `docs/REQUISITOS.md`, se podrá cargar con un script dedicado. Hasta entonces, no mezclar esos renglones con seeds de prueba.
