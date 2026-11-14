> Contrato vigente D3 (12/11/2026): los vehículos no limitan. Las referencias a límites físicos en resultados históricos describen versiones anteriores; no se activan ni se configuran. La capacidad actual son los instructores libres compartidos entre A y B.

# Lote 1 — modelo aditivo y backfill 068/069

Partida autorizada: backend `bcceca93badf9c6dfee7008ef27f37611baca5ff` y frontend
`246ea627e14d71d6e7d1197089bc1b8620124428`. Rama nueva en ambos:
`feat/cohortes-reglas-inscripcion`. Sin push ni aplicación remota por el agente.

## Alcance y compatibilidad

- 068 crea el catálogo **único por tipo A/B**, precios/fechas propios, código y campos
  de cohorte, permisos explícitos, auditoría, eventos y parámetros de oferta.
- 069 llena únicamente campos nuevos a partir de evidencia propia; conserva
  `monto_total`, `monto_abonado`, `practice_plan`, estados y `updated_at` anteriores.
- No se reemplaza ninguna RPC legacy de reserva, pago, admisión ni acceso. Los tipos
  de transporte son aditivos y opcionales; no se publica un endpoint nuevo.
- Los 14 indicadores tienen `enabled=false`, `implemented=false`. Un CHECK impide
  activar un indicador no implementado. La aplicación solo tiene SELECT sobre las
  nuevas tablas; no hay concesiones automáticas a administradores ni acceso web.
- Cada lote futuro implementará y probará su indicador antes de ofrecer activación.
  No hay fallback que active reglas si falta configuración. No usar NEXT_PUBLIC
  para tomar decisiones de autorización.
- Las 12 combinaciones de modalidad/horas están parametrizadas con objetivo 10 desde C08; las matrículas anteriores conservan 15.
  Fin de semana/1 hora queda deshabilitada en el catálogo futuro, pendiente de negocio.
  Esto no cambia las opciones del flujo legacy mientras sus indicadores estén apagados.
- `cohorts.precio` sigue atendiendo al código legacy. No se elimina ni se sustituye
  su lectura en lote 1. El catálogo nuevo es el destino canónico del lote 3.
- `migrations/064_precio_por_tipo_curso.sql` y sus tres scripts se conservan intactos.
  Son borradores excluidos expresamente. 068 detecta `courses.precio` y aborta si
  encuentra indicios de aplicación de esa propuesta incompatible.

## Evidencia y decisiones de backfill

`private.lote1_enrollment_evidence` y `private.lote1_reservation_evidence` son vistas
de solo lectura con `security_invoker`, disponibles únicamente para operación/backend.
`private.lote1_preflight_cases` entrega filas exportables:
`entity_type, entity_id, issue, evidence`. No contiene nombres, correos ni documentos.
Los UUID y fechas siguen siendo información de operación: guardar las exportaciones
en ubicación privada, nunca en Git ni en logs públicos.

Fuentes admitidas para fechas:

1. Fechas civiles válidas del array `practice_plan.fechas`; el fin es la última fecha
   efectiva, **no** `fechaFinElegida` ni el fin actual de cohorte.
2. Una única reserva confirmada con holds completos frente al objetivo **guardado
   en la matrícula/plan**, no frente al objetivo mutable del curso actual.
3. Franjas completas del alumno/cohorte solo cuando corresponden inequívocamente a
   una matrícula y existe un objetivo histórico con el que demostrar completitud.

Fuentes contradictorias, fechas inválidas, franjas incompletas o asociación ambigua
quedan pendientes. `individual_dates_guard_ready` permanece falso **también en los
casos con fechas demostrables**: este lote no activa el guard de acceso.

Importes:

- El monto pagado se copia de la instantánea de matrícula, contrastándola con el
  pago aprobado si existe. Una discrepancia queda pendiente, sin sobrescribirla.
- El precio histórico de una reserva solo puede recuperarse de sus pagos registrados
  si todos acreditan un único subtotal. Se etiqueta `payment_snapshot` y su fecha real
  de evidencia; nunca se afirma que ese importe se capturó al crear la reserva.
- No se usan precios actuales de cursos/cohortes ni valores del borrador 064.
- Las reservas antiguas no reciben una admisión ficticia bajo reglas futuras.

La tabla privada `enrollment_backfill_069` conserva antes/después, evidencia y fechas
de aplicación/reversión. Una repetición no pisa un dato nuevo ya intervenido.
Las excepciones históricas requieren aprobación individual con actor, motivo y
evidencia, en el lote que active el guard. No editar la evidencia para hacerla pasar.

## Precios y administradores aún no identificados

`inscripcion-lote1-datos.sql` es una carga separada, manual y revisable. Sus variables
son NULL y aborta hasta completar precios A/B **en centavos**, UUID de dos admins
distintos y actor aprobador. Comprueba que sean admins activos, concede exactamente
cuatro permisos por cada uno y escribe diez auditorías. No incorpora un tercero,
ni usa emails para elegir personas, ni activa indicadores. Una recarga aborta.

Los marcadores `150.00 USD (D7)`, `200.00 USD (D7)`, `administradores existentes (D8)`, `administradores existentes (D8)` no son valores.
No fueron sustituidos por ejemplos. Transferencias/depósitos están fuera del alcance.

## Guion de despliegue manual

Este documento es una entrega para el operador. **El agente no ejecuta estos pasos
en Supabase remoto.** Antes de producción se ensayan sobre una copia aislada y
sanitizada en PGlite/PostgreSQL embebido local. No pasar una URL remota a los tests.

1. **Respaldo previo.** Obtener respaldo lógico completo de esquema y datos con el
   procedimiento de respaldo del proyecto. Incluir Auth y Storage según el protocolo
   existente: una exportación CSV de tablas no reemplaza el respaldo completo. Guardar
   también definiciones/ACL de RPC legacy y conteos/importes anteriores. Verificar que
   el respaldo puede restaurarse en una copia antes de continuar. Registrar operador,
   hora y SHA de los archivos, sin copiar datos personales al repositorio.
2. **Comprobar base.** Confirmar que están aplicadas las migraciones autorizadas hasta
   067, incluidas 066a y 066b, y que 064 no se aplicó. No volver a ejecutar todo el
   historial sobre una base existente. Revisar los checksums/definiciones contra el
   respaldo y detenerse ante divergencias.
3. **Ensayo de copia.** Restaurar la copia sanitizada en una instancia embebida local,
   verificar sus datos, ejecutar el preflight 068, aplicar 068, ejecutar preflight 069
   y exportar `private.lote1_preflight_cases`. Revisar todos los casos con el dueño.
   Aplicar 069, verificar, ensayar rollback 069 seguido de rollback funcional 068.
   Comparar tablas/importes/planes/versiones originales, reaplicar y verificar otra vez.
   No importar un dump que conserve conexiones, extensiones de red o jobs remotos.
4. **Preparar código compatible.** Desplegar solo los contratos aditivos revisados;
   no habilitar indicadores. El frontend de este lote no necesita nuevas respuestas.
5. **Aplicar manualmente en Supabase**, mediante el procedimiento SQL habitual y en
   una ventana de mantenimiento sin escritores concurrentes:
   - `inscripcion-068-preflight.sql` → revisar resultados.
   - `migrations/068_inscripcion_modelo_base.sql` → archivo completo.
   - `inscripcion-068-verificacion.sql` → debe terminar sin excepción.
   - `inscripcion-069-preflight.sql` → exportar decisiones pendientes.
   - `migrations/069_inscripcion_backfill_trazable.sql` → archivo completo.
   - `inscripcion-069-verificacion.sql` → revisar resultados y procedencias.
6. **Datos explícitos.** Solo cuando existan precios e identidades reales aprobados,
   revisar y ejecutar la copia completada de `inscripcion-lote1-datos.sql`. Esta carga
   no forma parte de F45. Conservar su evidencia de aprobación en el canal privado.
7. **Verificación posterior.** Confirmar 14 indicadores apagados, 12 combinaciones,
   guard individual falso, ACL/RLS cerradas y ausencia de cambios en importes, planes
   y funciones legacy. Comparar contra el respaldo. Confirmar cero envíos/eventos de
   facturación nuevos: este lote no instala workers ni cambia el comportamiento web.
8. **Rollback.** Detener escritores y ejecutar primero `inscripcion-069-rollback.sql`,
   después `inscripcion-068-rollback.sql`. 069 compara datos actuales con su resultado
   registrado y **aborta** si alguien los cambió o eliminó: no sobrescribir a mano.
   068 es rollback funcional no destructivo: conserva el esquema aditivo, catálogo,
   permisos/auditorías cargados y procedencia; deja indicadores apagados. No pretende
   ser un DROP físico del esquema. No elimina filas para aparentar una reversión.
   Restaurar código anterior solo si la comprobación de compatibilidad lo permite.

Preflights y verificaciones terminan en ROLLBACK. Las dos migraciones, la carga de
datos y sus rollbacks tienen transacción propia. Un error deja la transacción abortada:
ejecutar ROLLBACK antes de cualquier operación posterior y revisar la causa.
El lock_timeout es 5 segundos: si vence, detenerse y reprogramar, sin quitar guardas.

## F45 local

`tests/helpers/migrationManifest.ts` enumera los 69 archivos aprobados. Ambos cargadores
lo utilizan; acepta identificadores completos, incluido `066a`/`066b`, y rechaza 064,
límites desconocidos, archivos ausentes y SQL numerado no revisado. El default es 069.
Los scripts de operaciones de contenido usan `examenes-*`; 068/069 exigen los tres
scripts. El historial más antiguo conserva N/D donde nunca existió un script.
Un preflight/verificación/rollback fallido detiene el recorrido con código de error.
Las copias de Storage incluyen RLS, reproduciendo el requisito del preflight 065.

```sh
npm run test:lote1
npm run check:inscripcion-migrations
```

Reportes locales: `/tmp/inscripcion-f45.json` y
`/tmp/lote1-preflight-fixtures.json` (este último contiene **solo fixtures sintéticos**).
El código del arnés no importa configuración de Supabase, correo ni HTTP.

Para exportar casos de la copia revisada, ejecutar en su cliente SQL local y exportar
el resultado como CSV o JSON (la vista existe después de 068):

```sql
select entity_type, entity_id, issue, evidence
from private.lote1_preflight_cases
order by entity_type, entity_id, issue;
```

## Guía QA manual

Usar exclusivamente una base **local desechable**, con el esquema aprobado hasta
068 y `tests/fixtures/lote1-foundation.sql`. Nunca cargar esos fixtures en producción.
El arnés del test crea esa base y la restablece desde snapshot en cada caso; no abre
puertos. Ejecutar `npm run test:lote1` permite reproducir los resultados automáticamente.
Para inspección paso a paso, ejecutar `npm run qa:lote1`. Abre una consola PGlite
local con esos fixtures, sin puertos, URL ni conexión remota. Escribir `preflight`,
`apply`, `verify`, `export`, `rollback`, `reset` o `exit`. `export` crea
`/tmp/lote1-qa-cases.json`, marcado como sintético. Se puede inspeccionar con una línea
`sql SELECT ...`. `reset` restaura el snapshot y `exit` destruye la base.
Usar Node 22, conforme al rango de engines del backend.

| Caso/datos | Pasos | Resultado esperado | Restablecimiento |
| --- | --- | --- | --- |
| Base 068 vacía | Ejecutar verificación 068; consultar precios/permisos | 14 indicadores apagados; cero precios/permisos; 12 opciones; fin de semana/1 h pendiente | Recrear base local |
| Matrícula fixture terminada en `001` | Preflight 069, aplicar 069, consultar fechas | 07–08/01/2030; acceso 08/01; no 01/02 elegido ni fechas 2035/2040 de cohorte; guard falso | Rollback 069 |
| Fixtures `002`, `003`, `004` | Preflight y 069 | Faltante, fecha inválida y conflicto exportados; fechas nuevas NULL | Rollback 069 |
| Fixture `005` con 15 holds | Aplicar 069 y consultar matrícula/reserva | Fin 09/01/2030; pagado 10000; subtotal de reserva 9000, fuente payment_snapshot; admisión NULL | Rollback 069 |
| Fixture `007` con importe contradictorio | Preflight y 069 | Conflicto exportado; paid_amount nuevo NULL; montos originales intactos | Rollback 069 |
| Hold incompleto | Quitar un hold solo en fixture/copia, aplicar 069 | No se afirma plan completo de `005` | Recrear snapshot |
| Nombres con acentos en cursos distintos | Crear variante de nombre y consultar preflight | Colisión global exportada sin renombrar; todavía no se impone la futura regla | Recrear snapshot |
| Repetición | Aplicar 069 dos veces | Mismo journal y mismos valores; no duplicación | Rollback 069 |
| Reversión | Revertir 069 y luego 068 | Valores nuevos restaurados, versiones/legacy intactos y procedencia conservada | Reaplicar 069 en copia |
| Cambio posterior | Tras 069 cambiar acceso de `001`; intentar rollback | Aborta y conserva el cambio posterior | ROLLBACK; recrear snapshot |
| Privilegios | SET ROLE authenticated; consultar tabla nueva; luego service_role y tratar de actualizar flags | Ambos intentos no autorizados fallan; service_role sí lee configuración | RESET ROLE |
| Carga sin marcadores resueltos | Ejecutar script de datos tal como está | Aborta sin cargar nada | ROLLBACK |
| Carga con dos admins sintéticos y precios de fixture | Completar solo en copia local y ejecutar | 2 precios, 8 permisos, 10 auditorías, ningún indicador activo; segunda carga aborta | Desechar base de prueba; no borrar auditorías reales |

## Ajustes aceptados para lotes siguientes — sin implementación aquí

- **Lote 3/cupo por intervalo:** usar `[inicio, fin_individual + 1 día)` por matrícula
  y reserva, incluyendo retenciones de pagos inciertos. Filtrar intervalos que se
  solapan con el rango solicitado por cohorte; producir +1 en inicio y -1 en fin
  exclusivo, agrupar por fecha y calcular suma acumulada. El máximo debe ser menor
  que el cupo antes de agregar la nueva inscripción. Esta barrida evita expandir una
  fila por cada día de cada alumno y evita una tabla paralela de ocupación.
  Usar índices de cohorte/fechas (ya preparados) y evaluar GiST sobre daterange con
  EXPLAIN en copia si el volumen lo exige. Reserva/matrícula de una misma inscripción
  se cuentan una vez; cambio de plan descuenta solo su ocupación reemplazada.
  El cálculo definitivo se repite bajo los mismos locks de cohortes/franjas. Las
  cohortes solapadas comparten los instructores existentes, además de este tope.
- **Kushki:** la documentación oficial de Ecuador ofrece Analytics v2 para consultar
  transacciones, estados y correlación por ticket/referencia:
  https://api-docs.kushkipagos.com/es/ecuador/online-payments/analytics . Requiere que
  Analytics esté habilitado para el comercio. El adaptador local aún no implementa
  esa lectura: **PENDIENTE** de lote 3, validación de habilitación y contrato de respuesta.
  No confundir endpoints de payout/transferencia con consulta de tarjeta.
  Mientras falte, una revisión local detecta inconsistencias de registros/webhooks
  recibidos, pero no prueba ausencia de cobro ni descubre cobros sin respuesta/webhook.
  Esos pagos siguen inciertos y necesitan revisión; no se liberan por asumir rechazo.
- **Rechazos:** SPAM conserva correo suprimido; DATOS_INCONSISTENTES_O_FALSOS y VENCIDA
  tendrán texto neutro en lote 9. Este lote no cambia envíos.
- **Duración:** único constructor de planes y tabla/pruebas de las 12 combinaciones
  en lote 2 y sus consumidores posteriores; aquí solo se prepara el parámetro.
- **Cambio de horario:** 48 horas antes del instante de primera práctica.
- **Transferencias/depósitos:** fuera de alcance. Caja actual se conserva; devoluciones
  documentadas con motivo/auditoría, sin simular una operación del proveedor.
- **Facturación:** únicamente pagos nuevos tras activar el lote 8.
- **Recursos físicos:** sigue faltando confirmar si vehículos u otro recurso limitan
  concurrencia. No se inventa una capa paralela.

## Alcance de pruebas actualizado

Por instrucción del dueño, desde el ajuste solo se ejecutan tipos y pruebas
obligatorias del lote autorizado. No se repiten lint/build completos ni regresión
amplia por lote. Las ejecuciones previas se conservan como evidencia histórica.
Las pruebas diferidas, riesgo y lote funcional están en
[PRUEBAS_PENDIENTES.md](../PRUEBAS_PENDIENTES.md).

Aprobaciones: **1 solo → 2+3 → 4+5 → 6+7 → 8+9+10 → 11**.
Cada grupo requiere aprobación antes de empezar, entrega y parada al terminar.
Las pruebas de fechas, reserva, permisos, privacidad API y demás invariantes obligatorios
se ejecutarán en su grupo, sin reducirlas ni sustituir concurrencia real por promesas
serializadas. Las 12 duraciones se comprobarán en una prueba parametrizada con
los mismos vectores TypeScript/SQL en el grupo 2+3, sin implementar ese grupo aquí.
Ante fallo de una prueba obligatoria se informa y se detiene, sin añadir skips.

Al terminar lote 1 se detiene el trabajo. No se ejecuta ni implementa lote 2.
