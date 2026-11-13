## Estado vigente final — I01–I14 cerradas (2026-11-04)
Fases 1–4 completas. No queda implementación I10–I14 pendiente por contexto.
I10 backend:2eaf461 / 78e49aa / 05c077a (060 + ampliación062).
I11 backend:a800f18 / 784d2ff / a3a7ffc (proveedores/webhook/dispatch simulado).
I12 backend:91aba49; frontend:4bca7e6 (correo, checkout, efectivo/liberar).
I13 backend:e9539f6; frontend:afe718e (061, documentos/acceso pospago).
I14 backend:4c78317; frontend:e04caf9 (runbooks, orden y guion manual).
058→059→060→061→062 NO aplicadas remotamente.056/057 aplicadas e intactas.
063–064 reservadas. F45hasta062:62 aplicaciones/40 preflights/33 verificaciones/
43 rollbacks OK. Typecheck global backend y aplicación frontend, eslint src/backend
y app/components/hooks/lib/types/proxy/next.config frontend:0 errores/advertencias.
Build backend y frontend aplicación webpack OK tras todos los cambios runtime.
Frontend excluye temporalmente tests heredados (9 errores de tipos conocidos) y
.claude del build; tsconfig restaurado sin diff. No se corrigieron ni ejecutaron tests.
Sin push, SQL remoto, .env, secretos ni servidores. Progreso/deuda quedan sin commit.
Pendiente operador: aplicar058→062, credenciales/certificación UATKushki y webhook
HTTPS, definir IVA y conservación/conciliación financiera. Fase final de pruebas
y F43 siguen aplazadas a petición expresa; son requisitos antes de producción.
Historial a continuación: este encabezado prevalece sobre estados intermedios.

# Flujo del alumno H7 — estado vigente

2026-11-04. Sin subagentes, push, SQL Supabase, .env, secretos ni servidores. No
suites ni tests nuevos; excepción explícita: arnésF45 para migraciones nuevas.
Ramas: feat/inscripcion-en-linea backend; feat/inscripcion-en-linea-ui frontend.

Autorizaciones/estado real declarado por usuario:
- 056 y057 APLICADAS. No modificarlas ni renumerarlas. 057 leída antes deI02;
  define el finalizador de aprobación y corrige la conversión del estado enum.
- Nuevas:058(I02),059(I05),060(I10),061–064 reservadas. Orden doc actualizado.
- Tablas public: anon/authenticated sin privilegios; funciones solo service_role;
  RLS sin políticas. No tocar funciones de extensión ni Realtime/Storage.
- Matrícula de prueba actual permanece con status/cohorte/importes anteriores;
  NO convertirla; el operador la eliminará desde Alumnos.

I01 pendiente (no iniciada; instrucción actual explícita: continuar porI02).
I02 CERRADA:26fbb78 SQL058/runbook/orden +34db096 backend.
Frontend:3cc9c8d muestra etapa por agendar y bloquea asignación manual.
- Arnés001–058 OK:58 aplicaciones/36 preflights/29 verificaciones/39 rollbacks.
  Typecheck de aplicación y lint tocado OK backend/frontend. Sin otras suites.
  Build de cierre de fase se ejecutará al completar I04, no se cierra fase aquí.
- Campo etapa_inscripcion independiente de status, defaultactiva para existentes/
  manuales; nuevas solicitudes por_agendar, cohorte/monto null. Reserva se refleja
  como cohorte tentativa, status pendiente_cohorte y reserva_expira_at.
- Aprobación backend ya no consulta/asigna cohorte. SQL guarda perfil/matrícula/
  checklist/auditoría/intención055; mantiene enlace de acceso tras commit.
- Cupo SQL bajo lock de cohorte suma activas+reservas vigentes; lecturas ignoran
  vencidas, sin depender del cron. Sincronización real de franjas/I05-I08 pendiente.
- RPC y servicio de asignación admin bloquean etapas incompletas; detalle/listado
  exponen etapa/origen, UI mínima actualizada. Manuales/existentes conservadas.
- Eliminación/desactivación025/026 revisadas: por_agendar sin franjas y sin FK
  adicional no necesita cambios. I05 integrará sus filas detalladas en esos flujos.
- Guarda completa backend/acceso frontend corresponden aI03/I04, NO cerradas aquí.

Pendientes restantes: I03–I14. No ejecutar F23/F43 ni fase final de pruebas.
No desplegar esta fase incompleta con las guardas aún pendientes.


## Punto de continuación al cerrar I02 (histórico)
- I02 cerrada en ambos repos; fuente/lint y arnés058 correctos. Sin pruebas HTTP,
  suites, servidores, SQL Supabase ni cambios.env. 058 NO aplicada remotamente.
- Próxima tarea I03 (guarda servidor e incorporación de etapa/reserva a estado);
  I01 no iniciada en esta sesión por la instrucción de comenzar I02. Resolverla
  antes de cerrar Fase1; puede solaparse en lectura con servicio estado/documentos.
- I04 termina Fase1 y exige build de ambos repos. No activar reservas ni pagos
  hasta I05–I12; los campos de cupo de058 ya definen el contrato para I05.
- Brief completo: adjunto efb5d39a-c1e4-4039-bc29-17b7949f5f06/Pasted text.txt
  (/Users/lapcf051/.codex/attachments/). Mantener autorizaciones de este archivo.
- Etapa reservado usa cohort_id TENTATIVO y reserva_expira_at; no agregar un segundo
  campo de cohorte sin revisar esta decisión. status sigue pendiente_cohorte hasta
  pago. Manuales/existentes etapaactiva independientemente de status.

## Ampliación autorizada (2026-11-04, sin tareas nuevas)
- I04/I13: filtro p_pending solo para etapa_inscripcion='activa'; para otras etapas
  mostrar etiqueta Por agendar/Reservado en lista Alumnos. Si requiere SQL,061.
  Integrar visibilidad enI04 y contrato/filtro definitivo enI13; no crear tarea nueva.
- IC409: backend ya mapeado enI02 (cohortError→COHORT_CUPO_BELOW_ACTIVE,409).
  Revisar/añadir mensaje español explícito en frontend dentro deI04/I13.
- I10: misma transacción de confirmación actualiza users.status verificado→activo,
  etapa/estado matrícula, franjas/pago/notificación; auditar guardas de cuenta que
  dependan de users.status. Nunca activar antes del pago ni alterar manuales.
- I01 CERRADA:a2b179c backend FK explícita en estado/documentos +615f838 frontend
  tipos de identidad/documentos/detalle. Typecheck aplicación y lint OK; sin suites.
  Causa probable por PGRST201 (dos FK a cohorts), sin reproducir en servidor real.
- I03 EN CURSO. No cambios de estado remoto ni servidores/env.

I03 cerrada: guarda central en authenticate, allowlist de estado/contraseña/
notificaciones propias, estado ampliado con etapa/reserva/pasos/sangre declarada.
Manual/existentes conservan acceso; ante error DB503 falla cerrado. Requisitos
verificados no sustituyen el pago. Fecha primera práctica propia en solicitudes.
Typecheck/lint fuente OK; sin suites, SQL remoto, env ni servidores. Commit81ff459.
I04 CERRADA: frontend ee54b14; documentación backend ad3dde1.

Fase1 cerrada: I01–I04 completas. Typecheck aplicación/lint tocado OK ambos.
Backend npm run build OK; frontend build webpack de aplicación OK (exclusión
temporal de tests heredados con9 errores TS, config restaurada sin diff; fuentes
Google descargadas con permiso de red). No suites ni tests nuevos.
I04: stepper/documentos completos, guarda proxy/layout, menú limitado, badges
Por agendar/Reservado e IC409 español. Filtro p_pending SQL pendiente I13/061.
Próxima tarea I05/059. I09 completa selector; I12 checkout.

I05 EN CURSO:059 + preflight/verificación ROLLBACK/rollback/runbook creados,
primer arnésF45 completo OK; segundo recorrido con consulta por lote final en curso.
Typecheck backend OK, eslint src OK. Lint global no sirve como cierre en este
workspace:834 errores en .claude/worktrees antiguos y tests heredados; no se
modificaron ni se ejecutaron esas pruebas. SQL validado solo por arnés autorizado.
I05 CERRADA: bd6bc05. F45 final001–059:59 aplicaciones/37 preflights/30
verificaciones/40 rollbacks OK. Typecheck y eslint src OK. Sin otras suites.
059 NO aplicada remotamente. Funciones reservar/ampliar/liberar/vencer/confirmar,
lease por franja con exclusión temporal, cupo058, contador3/día,TTL15/ext1x10/gracia10.
Manual respeta holds y cupo; desactivar libera, eliminación026 cascade. Confirmación
privada solo para transacciónI10 después de activar usuario/matrícula; llegada tardía
revalida franjas. I10 debe capturar conflicto y conservar pago en revisión.
Próxima I06: motor y config; I07 rutas/ratelimit; I08 limpieza/cron; I09 selector.
I06 CERRADA: e012f9d. Motor usa sessionDates del wizard manual y free_instructors
por lote059, solo devuelve celdas libres; cohorte elegible para TODO calendario/margen,
cupo vivo y matrícula abierta hoy. Último día parcial y solapes propios contemplados.
Reserva revalida propiedad/datos/fechas/total; SQL elige cohorte/instructor bajo lock.
Config validada/cotas SQL, .env.example sin secretos, .env intacto. Errores manuales
IR409 y de cohorte IR413 en español. Typecheck y lint tocado OK; sin suites.
Próxima I07 endpoints propios/ratelimit, luego I08/I09 y builds fase2 ambos repos.
I07 CERRADA: 81bc79a. Cinco rutas autenticadas (POST disponibilidad/reservas,
GET reserva, POST reservas/:id/ampliar|liberar), propiedad JWT, cuerpos estrictos,
ratelimits por sujetoHMAC y límites persistentesSQL. Allowlist I03 solo esas rutas;
pago aún sin endpoint. Typecheck/lint tocado OK, sin pruebas ni SQL remoto.
Próxima I08 limpieza estado+cron cada minuto, luego I09 y builds ambos repos.
I08 CERRADA: 97cdcf8. Estado/account-status/guarda, actual/acciones, disponibilidad
/reservar limpian perezosamente; cron cada minutoGuayaquil respetaDISABLE_CRON,
lote100/5paralelos, relojSQL, serialización por alumno, aviso bandeja exactamenteuna
vez. Cupo/leases ignoran vencidas aun con cron apagado. Logs solo totales/códigos.
Typecheck/lint tocado OK; sin pruebas, sin SQL remoto ni servidores.
Próxima I09 frontendPaso2 y builds ambos repos para cerrar fase2.
I09 CERRADA: 346e2d1 frontend + 4dad62f backend/doc. Selector día×hora,
modalidad/inicio/1–6h, plan exacto (último parcial), resumen/cohorte sin instructor;
reserva/liberación confirmada, countdown global serverNow/reloj monotónico, aviso5min,
ampliar una vez, resync30s/foco, vencimiento SQL→banner/Paso2. No cobro hastaI12.
Estado prioriza matrícula reservada si existen varias propias incompletas.
Typecheck aplicación/lint tocado OK ambos; builds backend y frontend aplicación
webpack OK (tests y .claude excluidos temporalmente; tsconfig restaurado sin diff).
Fase2 COMPLETA: I05–I09. No tests nuevos, sin suites salvo arnés autorizado059,
sin push/SQL remoto/env/servidores. Progreso/deuda sin commit.059 NO aplicada.

## Continuación vigente después de fase2 (2026-11-04)
I01–I09 cerradas; fases1 y2 cerradas con builds de ambos repos. Próxima I10/060
no iniciada en esta tanda.058 y059 NO aplicadas remotamente; operador debe
aplicarlas en orden antes de probar el nuevo runtime.057/056 aplicadas e intactas.
Fase3: I10 pagos/idempotencia/transacción users.status verificado→activo + matrícula,
franjas, notificación; revisión de pago tardío sin dinero perdido. I11 proveedores
(simulado/manual y Kushki solo con documentación oficial), I12 checkout/correo/admin.
Fase4: I13 filtro p_pending solo etapaactiva con061 (badges y errorIC409 ya enI04),
acceso pospago/guardas/status/perfil/documentos/horarios/historial. I14 documentación.
060 reservada I10;061 filtro I13;062–064 disponibles. Sin ejecutar F23/F43 ni pruebas
salvo nuevos arneses de migraciones. Mantener reglas duras y .env intacto.

## Tanda I10–I14 (2026-11-04, vigente)
I10 CERRADA: 2eaf461 / 78e49aa.060 payments/eventos/outbox con RLS sin políticas,
solo service_role, importes servidor en centavosUSD, IVA0documentado/recargo0default.
Idempotencia intento/referencia/evento, dispatch único; gracia única incluso tras
rechazo. Aprobación atómica users.status verificado→activo + matrícula/abono/franjas,
aviso/outbox. Aprobado tardío/imposible o monto distinto conserva dineroenrevision,
sin activación parcial. No cambios057/058/059 ni SQL remoto.060 NO aplicada.
Guardas de borrado ahora por alumno y ANTES de ban/Storage; pendiente/aprobado/
revision bloquea409 en español, sin pagos/solo rechazados conserva026. Auditado
status: HTTP/RBAC usan activo y etapa; Realtime/módulos usan enrollment.statusactivo.
F45final001–060:60aplicaciones/38preflights/31verificaciones/41rollbacks OK.
Typecheck/lint tocado backend OK; sin otras suites. Fase3 no cerrada hastaI12+builds.
Siguiente I11 proveedores/rutas/webhook, luegoI12 UI/correo/admin; I13/061; I14docs.
Docs Kushki SÍ accesibles: charges POST https://api-uat.kushkipagos.com/card/v1/charges
con Private-Merchant-Id según https://docs.kushki.com/ec/card-payments/one-step-payments/accept-a-payment/.
HostedFields npm @kushki/js-sdk/init/initCardToken/requestToken, nuncainputsPAN propios.
Firma oficial X-Kushki-Signature=HMACSHA256(JSON.stringify(body)+'.'+X-Kushki-Id),
no SimpleSignature (no liga cuerpo). Idtimestamp, keymerchant; consultar guía oficial
https://docs.kushki.com/ec/notifications/overview/ y webhook-card/ (campos snake_case,
metadata, amount, transaction_status APPROVAL/DECLINED, transaction_reference).
Referencia antigua API de guía devuelve404; seguir linkactual en portalHostedFields.
No se puede declarar docs inaccesibles para saltarse Kushki. Aún NO implementadoI11.
Pendientes operativos: credenciales/comercio/webhookKushki, definición fiscalIVA y
política de conservación financiera antes de permitir eliminar alumnos con pagos.
I11 EN CURSO: lectura de fuentes oficiales; sin código aún. GuíaEC confirma charges
/card/v1/charges, firma canonicalbody.timestamp y HostedFields. El link de reference
charge desde HostedFields redirige a México: contrastar con guíaEC, no asumir campos
tributarios mexicanos. Consultas oficiales adicionales pendientes en I11.
I11 CERRADA: a800f18. Proveedores simulado/manual/Kushki implementados con interfaz
común; simulado no arranca conNODE_ENVproduction. Variables soloKushki condicionales,
recargoentero, .env.example ficticio y .env intacto. Rutas propias JWT/allowlist,
adminMFA/rol/SQLactor para efectivo/liberar; límitesHMAC,JSON16KB,no-store.
Kushki POSTcharges verificado en docsEC + entornos oficiales API: token HostedFields
soloenmemoria, contacto propio Auth/solicitud, sin PAN/CVV ni cobro de prueba real.
Claimdispatch único; respuesta incierta queda pendiente, nunca reintenta cobro.
Webhook HMACfuerte canonicalbody.timestamp/merchant/time185min(policyretry3h)/replay
SQL/monto real contra snapshot; solo webhooks válidos pueden activar Kushki.
Fuentes y contratos en inscripcion-pagos-proveedores.md; adaptadorNOesqueleto.
Typecheck/lint tocado backend OK; sin suites. Sin build hasta cerrarI12/fase3.
Siguiente I12: frontendPaso3(simulado/resultados/HostedFields), correooutbox/cron y
acciones mínimasadmin. I13 filtro061/planfijo/docsmenú; I14runbook/diagrama/manual.

I12 EN CURSO: backendcorreo/outbox/cron y frontendcheckout simulado/HostedFields1.10.0,
adminacciones y CSP de pago implementados. Typecheck/lint tocado ambos OK; builds
para cerrar fase3 en curso. Sin pruebas/SQL remoto/.env/servidores.

I12 lista para commit: typecheck/lint tocado ambos y builds fase3 OK. SDK1.10.0
fijado necesario paraHostedFields, sin PAN/CVV propio. Webhook sigueconciliando al
cambiar proveedor si conserva claves. Cotización admin antes de confirmar efectivo.
Progreso/deuda sin commit; 058/059/060 aúnNOaplicadas.
I12 CERRADA:91aba49 backend/4bca7e6 frontend. Correo welcome/outbox/cron/lazy,
checkout simulado+HostedFields oficial1.10.0, estados/recuperación de pago por
matrícula, admincotización/efectivo/liberar mínimos. Typecheck/lint tocado y builds
aplicación ambos OK. Fase3 COMPLETA (I10–I12). Sin suites/.env/SQLremoto/servidores.
I13 EN CURSO:061 filtro por etapaactiva, revisión de menú/documentos/plan/historial
pospago. I14 después.058/059/060 NO aplicadas remotamente,057 intacta.

I11 revisión final:784d2ff rechaza importes presentes de tipo ambiguo/ausentes sin
inventar cero; typecheck/lint fuente OK, sin pruebas.
I13 CERRADA:e9539f6 SQL061/afe718e frontenddocs. Filtro true/false exigeetapaactiva,
sinfiltro mantiene todas/badges. Plazo primera práctica explicado/carné destacado,
menú/horarios/instructor propio/historial revisados. IC409 ya mapeadoI04.
F45hasta061:61aplicaciones/39preflights/32verificaciones/42rollbacks OK.
Typecheck/lint tocado ambos OK.061 NOaplicada. I14doc/runbook y buildsfinales en curso.

I10 ampliación CERRADA:05c077a (062). Checkout abandonado sin dispatch caduca como
rechazado NO_ENVIADO_VENCIDO al vencer el lease, evento único. Claim revalida cuenta,
propiedad, etapa y clases futuras. Nunca caduca pagos ya enviados ni efectivo durable.
F45hasta062:62/40/33/43 OK; aplicación remota pendiente. Sin modificar060/057.
I11 ampliación CERRADA:a3a7ffc. Simulado también reclama dispatch y no ejecuta el
proveedor sin dispatch; resultados pendientes ya enviados pueden resolverse tarde.
Typecheck global backend, eslint src y build OK tras este cambio. Build aplicación
frontend OK tras I13; tsconfig restaurado. I14 documentación/cierre en curso.

I14 CERRADA:4c78317 backend / e04caf9 frontend. Diagrama, variables, incidentes,
orden058→062, comandos de inicio para el operador, aceptación simulado/console y
UATKushki con datos oficiales; ganchos de descargas/exámenes sin implementarlos.
Fase4 COMPLETA (I13–I14) y entrega I01–I14 cerrada. Typecheck/lint fuente ambos y
builds finales OK; no suites. F45hasta06262/40/33/43 OK. Supuestos conservados:
IVAconstante0 pendiente definición, pago completo, referencia de recibo textual,
revisión financiera sin reembolso automático. Necesidades operativas arriba.

Corrección pre060 I10/I11 EN CURSO (2026-11-04), autorizada por el usuario:
060/061/062 NO aplicadas; corregir directamente, sin063. Hashes de comprobación
normalizanCR en migración/preflight/rollback. confirm_student_payment acepta cero
/moneda distinta para no aprobados, guarda reporte y resuelve referencia faltante
bajo lock. Webhook prioriza request_amount enDECLINED, correlaciona por ticket si
metadata no sirve, y responde202sinmutación/logsinPII si no hay pago. Typecheck/lint
fuente OK. F45 LF final OK; copia CRLF final en curso. Sin HTTP/suites/SQLremoto/env.
