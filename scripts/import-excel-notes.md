# Notas de importación

Este repositorio **no** ejecuta una carga automática del Excel contra Supabase.

Motivo: hay cantidades contradictorias, el tablero no está clasificado y la hoja Ventas es una proyección. Cargar eso como inventario y ventas reales contaminaría los reportes.

Cuando se confirmen las preguntas de `docs/REQUISITOS.md`, el proceso seguro es:

1. Revisar `data/excel-extract/*.csv`.
2. Registrar 3 aportes de capital (15 + 15 + 15) si la moneda se confirma.
3. Crear productos **sin** marcar ventas.
4. Confirmar **compras** con Precio Promo y la cantidad acordada (no la proyección de Venta Total).
5. El tablero: o gasto operativo, o producto no publicado, según la respuesta.
6. No crear ventas hasta que exista una venta real.
