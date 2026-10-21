# Bloqueos

| Ítem | Impacto | Qué se hizo igual |
| --- | --- | --- |
| No hay proyecto Supabase ni claves en este entorno | No se aplicó la migración a una base real ni se probaron RPC/RLS contra Postgres hospedado | SQL en el repo; modo local + tests de las reglas |
| Correos/UUID de los 3 admins | No se pueden crear `admin_users` reales | Documentado el SQL de alta |
| Número de WhatsApp | El botón público queda inactivo hasta configurarlo | Campo en ajustes y `VITE_WHATSAPP_PHONE` |
| Preguntas financieras del Excel (moneda, tablero, cantidades, ventas reales) | No se importan datos reales | Extracto CSV de solo lectura; app arranca con datos ficticios en modo local |
