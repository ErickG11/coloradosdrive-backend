# Resultado del Lote 1

Fecha de cierre: 2026-11-12, America/Guayaquil. Solo 068/069 y su infraestructura de
verificación. No se inicia lote 2, no hay push ni consultas/migraciones remotas.

## Validación ejecutada

Runtime de validación final: **Node 22.23.5**. Se obtuvo el binario oficial de Node
en `/tmp`, contrastando SHA-256 con el manifiesto de nodejs.org, sin instalación
global ni cambios en dependencias/lockfiles. Node 24 del sistema también ejecutó
pruebas preliminares, pero los resultados siguientes se confirmaron con Node 22.

| Comprobación | Resultado real |
| --- | --- |
| `npm run test:lote1` | 14/14 pruebas, 0 omitidas |
| Regresión: cohortRules, cohortEligibility, manualPracticePlan, cohortAssignment.service | 72/72 pruebas, 0 omitidas |
| F45 hasta 069 | 69/69 migraciones OK; 47 preflights OK; 40 verificaciones OK; 50 rollbacks OK |
| Scripts históricos no existentes | 22 preflights, 29 verificaciones y 19 rollbacks N/D; no se presentan como comprobados |
| Preflight/verificación/rollback 068 y 069 | Los seis OK, sin N/D |
| `npm run build` backend | OK |
| ESLint de archivos TypeScript cambiados | OK en ambos repositorios |
| `tsc --noEmit --incremental false` frontend completo | OK |
| Vitest: contratos de matrícula/reserva | 2/2 pruebas OK |
| Consola QA local | apply → verify → rollback → reset → export: OK |
| Borrador 064 y sus tres scripts | SHA-256 intactos; excluidos de los cargadores |
| Pruebas omitidas preexistentes | No modificadas ni incrementadas |

Los loaders no importan configuración Supabase, HTTP ni correo. F45 usa snapshots
PGlite; la regresión seleccionada usa reglas puras y dobles controlados.

Comprobación ampliada adicional: `tsc --noEmit --rootDir . -p tsconfig.eslint.json`
incluyendo **todos los tests backend** encuentra TS2835 en
`tests/unit/cors.test.ts:43` (import dinámico sin extensión con NodeNext). Se reprodujo
el mismo error en una copia temporal de la punta original `bcceca93`, sin los cambios
del lote. No se corrigió un archivo ajeno al alcance ni se presenta ese chequeo como verde.

Un intento preliminar de Jest interpretó el selector como parte de un argumento de
lista y amplió la selección; terminó con EPERM al abrir un puerto de una prueba HTTP.
Se corrigió el comando con `--runTestsByPath`; no se cambió ni omitió esa prueba.
No se certifica la suite global HTTP ni una build Next completa en este lote.
El aviso existente de ts-jest TS151002 no impidió las suites seleccionadas.

## Casos exportados

No se consultaron datos reales. La exportación producida por las pruebas y la
consola QA contiene **siete casos sintéticos**, no siete incidencias de producción:

| Fixture (sufijo de UUID) | Caso |
| --- | --- |
| Matrícula 002 | Sin fechas demostrables |
| Matrícula 003 | Fecha inválida en plan |
| Matrícula 004 | Plan y holds confirmados contradictorios |
| Matrícula 006 | Sin fechas demostrables |
| Matrícula 007 | Monto abonado y pago aprobado contradictorios |
| Matrícula 007 | Sin fechas demostrables |
| Reserva 004 | Sin precio histórico inequívoco |

Archivos locales: `/tmp/lote1-preflight-fixtures.json`, `/tmp/lote1-qa-cases.json` y
`/tmp/inscripcion-f45.json`. Las dos exportaciones de casos declaran
`syntheticFixturesOnly=true`. El inventario real requiere ejecutar el preflight
contra la copia sanitizada aprobada, según el guion; su resultado todavía es desconocido.

También se verificó con fixtures adicionales la detección de colisiones globales
de nombre con acentos y de fechas de cohorte incompatibles, sin corregirlas automáticamente.

## Archivos del lote

Backend:

- `migrations/068_inscripcion_modelo_base.sql`
- `migrations/069_inscripcion_backfill_trazable.sql`
- `docs/operations/inscripcion-068-{preflight,verificacion,rollback}.sql`
- `docs/operations/inscripcion-069-{preflight,verificacion,rollback}.sql`
- `docs/operations/inscripcion-lote1-datos.sql`
- `docs/operations/cohortes-lote1.md`
- `docs/operations/cohortes-lote1-resultados.md`
- `src/models/enrollmentFoundation.model.ts`
- `src/models/enrollment.model.ts`
- `src/models/studentSchedule.model.ts`
- `src/config/database.types.ts`
- `tests/helpers/migrationManifest.ts`
- `tests/helpers/enrollmentDatabase.ts`
- `tests/migrations/checkEnrollmentMigrations.ts`
- `tests/migrations/lote1LocalQa.ts`
- `tests/fixtures/lote1-foundation.sql`
- `tests/unit/enrollmentFoundationSql.test.ts`
- `package.json` (solo comandos locales de prueba/QA)

Frontend:

- `types/enrollmentFoundation.ts`
- `types/enrollment.ts`
- `types/studentSchedule.ts`
- `tests/types/enrollmentFoundation.test.ts`
- `docs/operations/cohortes-lote1.md`

## Pendientes y riesgos

1. Precios A/B y UUID de ADMIN 1/ADMIN 2 siguen siendo marcadores del pedido.
   El script explícito aborta hasta completarlos; no se cargaron valores inventados.
2. Falta confirmar recursos físicos adicionales y decidir oferta fin de semana/1 h.
3. Ensayo contra copia real sanitizada, decisiones históricas y aplicación manual
   en Supabase: pendientes del operador. Solo se ensayó con fixtures locales.
4. El rollback 068 es funcional y no destructivo: conserva esquema aditivo y datos
   de configuración/auditoría; 069 restaura campos únicamente si no cambiaron después.
5. La tabla nueva de precios no sustituye aún los lectores legacy. Todos los
   indicadores y guards nuevos siguen apagados; ningún cambio de negocio está activado.
6. Cualquier decisión de nombres duplicados, fechas incompletas o dinero contradictorio
   requiere aprobación documentada. No se activará el guard para esos casos por inferencia.

Guion de respaldo, orden manual, ensayo, verificaciones, rollback y guía QA:
[cohortes-lote1.md](cohortes-lote1.md). Incluye el cálculo eficiente de ocupación por
intervalos y el estado PENDIENTE del adaptador de conciliación para el futuro lote 3.
