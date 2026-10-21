# Requisitos — Venta Loca

Fuente principal: el archivo Excel original `Venta_Loca.xlsx` (no modificado).
Extracto de solo lectura generado en `data/excel-extract/`.

## Actores

- **Público:** consulta el catálogo de productos publicados y contacta por WhatsApp.
- **Administradores autorizados (3):** Vero, Rodri y Sofi. Inician sesión con Supabase Auth y operan el panel.

## Datos observados en el Excel

### Hoja `Productos`

Columnas usadas: Link Temu, Descripción, Precio Real, Precio Promo, Categoría.

Capital registrado (columna aparte):

| Persona | Monto |
| --- | --- |
| Vero | 15 |
| Rodri | 15 |
| Sofi | 15 |
| Total | 45 |

Otros totales de esa hoja:

- Gastado: 38.39 (suma de Precio Promo de los 15 renglones, incluido el tablero).
- Sobrante: 6.61 (45 − 38.39).

Categorías listadas en la hoja: Pines, Stickers, Ganchos, Figuras, Espejos, Otros.

El renglón «Tablero de Exhibición para Pins» no tiene categoría.

### Hoja `Ventas`

No es un historial de ventas confirmadas. Es una **proyección de precios** por lote:

- Cantidad de unidades del lote.
- Precio compra = Precio Promo del lote.
- Precio unidad = precio compra / cantidad.
- Precio venta unidad (precio al público planeado).
- Venta total = cantidad × precio venta unidad (asume vender todo el lote).
- Ganancia final = venta total − precio compra.

Totales al lado:

- Inversión: 35.20 (suma de Precio Compra **sin** el tablero).
- Venta total proyectada: 90.133.
- Ganancia final proyectada: 54.933.

Inconsistencias de cantidad (descripción vs. hoja Ventas):

- Stickers de Stitch: «100» en descripción, 101 unidades en Ventas.
- Stickers Hello K.: «51» en descripción, 50 unidades en Ventas.

## Reglas de negocio definidas (requisito + Excel)

1. Distinguir capital aportado, dinero gastado y ganancias. No mezclarlos en un solo número.
2. Separar **costo de mercadería comprada** (lotes confirmados) de **costo de mercadería vendida** (COGS de ventas confirmadas).
3. Registrar gastos operativos aparte de las compras de mercadería.
4. Conservar historial de compras y ventas **confirmadas**. El Excel actual no contiene ventas reales; solo precios objetivo.
5. Cada venta guarda el precio unitario y el costo unitario vigentes **en el momento de vender**.
6. Todo movimiento de inventario queda registrado (origen, producto, cantidad, costo de referencia, fecha, usuario).
7. No se puede vender más unidades que el stock disponible. Las confirmaciones concurrentes se serializan a nivel de producto.
8. La ganancia bruta de mercadería es `ingresos por ventas confirmadas − COGS`, no `ventas − compras`.
9. El Precio Promo es el costo de adquisición del lote. El Precio Real de Temu es informativo.
10. El precio de venta unitario de la hoja Ventas es el precio de lista inicial, no una venta ocurrida.

## Decisiones técnicas (no financieras)

- Interfaz: HTML, CSS y JavaScript con Vite. No se usa React: el alcance es un catálogo y un panel pequeño; un SPA de dos páginas con módulos ES es suficiente y más simple de desplegar en Vercel.
- Importes: enteros en céntimos en el cliente de prueba; `numeric` en PostgreSQL. Totales a 2 decimales; costos/precios unitarios a 4 decimales (los stickers valen fracción de unidad).
- Cantidades: enteros.
- Costo promedio ponderado del producto se actualiza **solo al confirmar compras**. Una venta no recalcula el promedio; congela el promedio vigente en la línea de venta.
- Autorización: tabla `admin_users` ligada a `auth.users`. No se usa `user_metadata` del JWT para permisos.
- Sin clave `service_role` en el frontend.
- Modo local (sin credenciales de Supabase): motor en memoria/localStorage con las mismas reglas, solo para desarrollo y tests. No es producción.

## Fuera de alcance hasta confirmar

No se implementan como si fueran reglas de negocio:

- Devoluciones, notas de crédito o anulación de ventas/compras confirmadas.
- Crédito a clientes o pagos parciales.
- Impuestos, comisiones de pasarela o tipo de cambio.
- Reparto automático de ganancias entre Vero, Rodri y Sofi.
- Múltiples monedas o conversión.
- Pedidos del catálogo público (solo contacto WhatsApp).

## Preguntas abiertas (bloquean datos financieros reales)

1. **Moneda:** los importes parecen dólares, pero no está escrito. ¿USD, moneda local, u otra?
2. **WhatsApp:** no hay número en el Excel. ¿Cuál es el número con código de país?
3. **Correos de los 3 administradores** para darlos de alta en Supabase Auth y `admin_users`.
4. **Tablero de exhibición:** ¿es gasto operativo, activo de uso interno (no se vende) o mercadería? No está en la hoja Ventas y no tiene categoría. La diferencia 38.39 − 35.20 = 3.19 es exactamente su Precio Promo.
5. **Cantidades Stitch (100 vs 101) y Hello K. (51 vs 50):** ¿cuál es el stock real?
6. **¿Ya se vendió algo?** La hoja Ventas parece proyección (Venta Total = stock × precio). Si hubo ventas reales, no están en este archivo.
7. **Fotos:** el Excel solo tiene links de Temu, no archivos. ¿Se suben fotos propias a Storage?
8. **Publicación:** ¿todos los productos del Excel se muestran al público desde el día uno, o se publican uno a uno?
9. **Unidad de stickers:** se vende por sticker suelto (precio ~0.125) y no por paquete cerrado. ¿Correcto para todos los lotes?
10. **Precio Promo vs Precio Real:** se asume que el negocio pagó el Precio Promo. ¿Hubo envío, impuestos o recargos no anotados?

Mientras estas preguntas sigan abiertas, la app usa datos **ficticios** en tests y no importa el Excel a producción automáticamente.
