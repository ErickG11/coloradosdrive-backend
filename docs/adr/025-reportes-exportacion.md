# ADR 025 — Reportes administrativos y su exportación a PDF y Excel

- Estado: aceptado (CD-346, hija de RF-08 / CD-12). Adelantado del Sprint 7.
- Fecha: 15/11/2026.
- Base de datos: sin migración nueva (la última sigue siendo la 094).
- Relación: la capa de datos de este ADR es la base que reutiliza CD-345 (panel de reportes).

## Contexto

RF-08 pide que el administrador consolide indicadores (ingresos por cohorte, aprobación por examen, asistencia a prácticas, ranking de instructores y saldo pendiente) según un rango de fechas y un filtro por cohorte o tipo de curso, y que los exporte en PDF (PDFKit) y en Excel (ExcelJS 4.4). Reglas: solo el administrador accede; el ranking de instructores solo lo ve el administrador; los reportes financieros incluyen únicamente datos del período.

Al empezar no existía trabajo de CD-345 ni ninguna generación de PDF o Excel en el repositorio. El resumen administrativo (CD-265) agrega en Node sobre lecturas paginadas de PostgREST.

## Decisión

### Una sola fuente de cifras

`ReportService` (`src/services/report.service.ts`) tiene una función por tipo de reporte. Todas reciben los filtros y el actor, y devuelven la misma estructura neutral (`src/models/report.model.ts`): título, columnas con su tipo, filas, fila de totales, indicadores, notas, gráfico y metadatos de filtros. Esa estructura la consumen tres salidas:

- `GET /admin/reportes` la entrega como JSON (panel de CD-345 y vista previa).
- `renderReportPdf` la dibuja con PDFKit.
- `renderReportExcel` la escribe con ExcelJS.

Así la pantalla, el PDF y el Excel muestran las mismas cifras por construcción; una prueba de paridad lo comprueba.

Convenciones de la estructura: el dinero viaja en **centavos enteros**; los porcentajes, como proporción 0–1 y `null` cuando el denominador es cero (se presenta «—», nunca `NaN` ni `Infinity`).

### Tipos de reporte

| Tipo (`tipo`) | Contenido | Fecha que cuenta |
| --- | --- | --- |
| `matriculas` | Matrículas por cohorte, tipo de curso y estado | Fecha de inscripción |
| `asistencia` | Prácticas asistidas, faltas, horas asistidas y % de asistencia por cohorte | Fecha programada de la práctica |
| `examenes` | Por examen: intentos finalizados, aprobados, reprobados, % de aprobación y nota promedio | Fecha de finalización del intento |
| `finanzas` | Ingresos confirmados por cohorte (en línea y en efectivo) y saldo pendiente | Fecha de confirmación del pago |
| `instructores` | Ranking: promedio, cantidad de calificaciones y desglose de 1 a 5 estrellas | Fecha de la calificación |
| `todos` | Los cinco anteriores | — |

### Definiciones financieras

- **Ingreso** = pago con estado `aprobado`, contado en `confirmed_at` (fecha de confirmación), no en la fecha de matrícula. Un pago de diciembre de una matrícula de noviembre es ingreso de diciembre.
- Los **pagos en efectivo** registrados por el administrador (`proveedor = 'manual'`) cuentan como ingreso confirmado, en su propia columna.
- Los **pagos simulados** de la demostración (`proveedor = 'simulado'`) nunca suman a los ingresos: aparecen en una columna y un indicador aparte. Con `DEMO_MODE=true` el documento se marca como «Datos de demostración».
- No cuentan los pagos pendientes, rechazados ni en revisión.
- **Saldo pendiente** = total menos abonado de las matrículas **inscritas en el período** (activas, pendientes de cohorte o finalizadas), calculado al generar el reporte. Se eligió esta definición para cumplir la regla de RF-08 («solo datos del período»); por eso puede diferir del «Saldo por cobrar» del resumen administrativo, que es el saldo de todas las matrículas vigentes hoy.

### Zona horaria y período

El período se interpreta en `America/Guayaquil`: desde las 00:00:00 del día `desde` hasta las 23:59:59 del día `hasta`, ambos inclusive. «Generado el» también se expresa en hora de Ecuador. Rango máximo: **366 días**; fecha mínima: 01/01/2000.

### Acceso

- JWT verificado por JWKS + `requireRole('admin')`, y el MFA de `/admin/*` cuando `ADMIN_MFA_REQUIRED=true`. No existe un rol «dirección»: el acceso es solo del administrador, como manda la tesis.
- El reporte financiero respeta además el permiso existente `view_payments_invoices` cuando la regla de permisos está activa: sin él, `tipo=finanzas` responde 403 y `tipo=todos` lo omite e informa el motivo en el documento.

### Límites

| Límite | Valor | Respuesta |
| --- | --- | --- |
| Rango de fechas | 366 días | 400 |
| Filas leídas por consulta | 20 000 | 413, pide acotar filtros |
| Filas presentadas por reporte | 2 000 | 413 |
| Consultas JSON por administrador | 120 cada 15 min | 429 |
| Exportaciones por administrador | 20 cada 15 min | 429 |
| Exportaciones de toda la plataforma | 60 cada 15 min | 429 |
| Exportaciones simultáneas en el proceso | 2 (espera máxima 4 s) | 429 `EXPORTACION_OCUPADA` |

Los límites de tasa se cuentan por administrador (no por IP) y después de autenticar, de modo que las peticiones anónimas no consumen cupo.

### Seguridad del contenido y privacidad

- Todo texto que va al Excel pasa por `neutralizeFormula`: si empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro se antepone un apóstrofo.
- El nombre del archivo lo genera el servidor con valores de listas cerradas y fechas validadas: `reporte-<tipo>-<desde>_<hasta>.<ext>`.
- Cabeceras: `Content-Type` exacto, `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. CORS expone `Content-Disposition`.
- Los reportes son agregados (LOPDP, minimización): no incluyen cédula, correo, teléfono, identificadores de alumnos ni datos de pago sensibles. El ranking es el único con nombres, y son de instructores. Los comentarios de las calificaciones **no se exportan**: son texto libre de alumnos y se consultan solo en pantalla.

### Auditoría

Cada exportación inserta una fila en `enrollment_domain_audit` (`action = 'report_exported'`) con el actor, el tipo, el formato, los filtros y el número de filas, sin datos personales. Si el registro falla, el archivo no se entrega (503): no hay exportación sin rastro. La consulta JSON no se audita.

## Alternativas descartadas

- **Generar el PDF en el navegador** (imprimir la página o una librería de cliente): las cifras dependerían de lo que el cliente dibuje, no quedaría auditoría fiable en el servidor y el resultado variaría entre navegadores y teléfonos.
- **Navegador headless en el servidor** (Puppeteer o Playwright): añade cientos de megabytes a la imagen y mucha memoria por exportación, lo que encarece Railway y arriesga el proceso persistente del backend. La tesis nombra PDFKit.
- **Funciones SQL o RPC de agregación**: serían más eficientes con mucho volumen, pero exigen una migración y duplican reglas que ya están en TypeScript. Con unos 200 usuarios la agregación en memoria tarda alrededor de un segundo para un año de datos. Queda como mejora si el volumen crece.
- **Tabla de auditoría nueva**: innecesaria; `enrollment_domain_audit` ya admite inserciones del rol de servicio.

## Consecuencias

- Dependencias nuevas: `pdfkit` y `exceljs` 4.4.0 (JavaScript puro, sin binarios).
- El PDF usa las fuentes estándar Helvetica (codificación WinAnsi): cubren tildes y eñes sin incrustar archivos. No usa Space Grotesk ni Inter, que exigirían distribuir los archivos de fuente; un carácter fuera de ese juego (emoji, otros alfabetos) se sustituye por `?`.
- Los abonos en efectivo anteriores a la regla de facturación no tienen fila en `payments`, así que no se pueden atribuir a un período y no aparecen como ingreso; sí reducen el saldo pendiente.
- Las devoluciones documentadas en facturación no se restan de los ingresos.
- CD-345 debe consumir `GET /admin/reportes` y no recalcular indicadores en el frontend.

Operación, parámetros y ejemplos: [reportes-exportacion.md](../operations/reportes-exportacion.md).
