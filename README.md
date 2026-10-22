# VRS Store

Aplicación web para un negocio pequeño de productos comprados en Temu: catálogo público y panel para tres administradoras (Vero, Rodri, Sofi).

Stack: HTML, CSS, JavaScript, Vite, Supabase (Auth, Postgres, Storage), Vercel. Sin React: dos páginas y módulos ES cubren el alcance.

## Arranque local (sin credenciales)

```bash
cp .env.example .env.local
npm install
npm test
npm run dev
```

`.env.example` deja `VITE_LOCAL_MODE=true`. El catálogo carga **productos ficticios**. Los admins locales son `vero@local.test`, `rodri@local.test` y `sofi@local.test`.

- Catálogo: `/`
- Panel: `/admin.html`

## Documentación

- [Requisitos](docs/REQUISITOS.md)
- [Decisiones de datos](docs/DECISIONES.md)
- [Plan y arquitectura](docs/PLAN.md)
- [Esquema](docs/SCHEMA.md)
- [Despliegue](docs/DEPLOY.md)
- [Bloqueos](docs/BLOQUEOS.md)
- Extracto del Excel (solo lectura): `data/excel-extract/`

Producción usa Supabase (no modo local). El Excel original no se modifica.

## Seguridad

- RLS: el público solo lee productos publicados.
- Operaciones de stock y dinero: funciones en schema `private`.
- Nunca uses `service_role` en variables `VITE_*`.
