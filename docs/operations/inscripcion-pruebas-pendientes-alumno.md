# Deuda de pruebas H7 (sin suites ejecutadas)

## I02 — etapas, aprobación y cupo
- Matrículas existentes manual/solicitud conservan estado, cohorte, importes, perfil
  y prácticas; solo nueva columna defaultactiva. Reaplicar058 no las reinterpreta.
- Aprobación con/sin cohortes disponibles: por_agendar, sin monto ni cohorte, cero
  abono/descuento; checklist físico y auditoría/intención055 completas; link de acceso.
- Requisitos identidad/estudios/consentimiento, MFA y rol admin no se relajan; falla
  Auth/red/correo/SQL conserva compensación correcta y nunca borra perfil confirmado.
- Resultado perdido al finalizar: comprobar commit antes de compensar, incluso
  unicidad. Un solo perfil/matrícula, repetir no crea nueva cuenta ni correo doble.
- Manuales siguen cupo, descuento/abono y asignación tardía actuales. Solicitud
  por_agendar/reservado no puede usar asignación admin: endpoint/RPC403 estable.
- Simultáneas: manual/reserva/pago para último cupo, ampliar al vencer, bajar cupo
  concurrente; lock cohorte, sin sobreventa ni doble conteo reserva→activa. F45
  de una sola conexión no acredita bloqueo real entre conexiones.
- Reserva vencida libera cupo lógico con DISABLE_CRON; I05/I08 limpian las franjas.
- Filtros Alumnos actuales y requisito cohorte, usedCapacity incluye reservas vigentes;
  detalle etapa, no botón manual en incompletas; UI resultado por_agendar y reenvío.
- Eliminar/desactivar/reactivar alumno por_agendar sin cohorte ni franjas; conservar
  comportamento manual. I05 debe ampliar con reservas vivas/pagos en curso.
- ACL/RLS: anon/authenticated sin acceso a tabla/RPC, solo service_role; no PII en
  logs ni errores SQL en pantalla. Rollback aborta con etapas nuevas, sin pérdida.
- Typecheck global frontend conserva9 errores en tests antiguos (no modificarlos);
  typecheck de aplicación usa configuración temporal que excluye esos tests.

## I01 — documentos y contratos
- GET estado-inscripcion de alumno real con FK simple y compuesta hacia cohorts:
  no PGRST201/500, cohorte propia o null; usuario ajeno sin acceso. No invocar SQL.
- Checklist para manual/solicitud, mayores65, no_sabe, sin matrícula/cohorte y
  servidor caído; frontend error español, reintentar, sin subir documentos.
- API vigente identidad devuelve transicion/confirmadaAt/certificadoOriginalVisto;
  detalle admin refleja studentId/vigente. No se alteran rutas antiguas sin consumidores.
- Comparación estática con scripts/local/contratos-observados.md; clientes activos
  usan lib/api/inscripcion.ts. Componentes legacy Data/Consent/DocumentsStep sin
  consumidores en app/wizard actual no se rediseñan ni corrigen en esta unidad.
- Causa del500 identificada por esquema/código (dos FK), sin reproducción HTTP
  por prohibición de servidores/pruebas. Verificar extremo a extremo en fase final.

## Ampliaciones integradas en I04/I13 e I10
- I04/I13: p_pending=true yfalse excluyen filas incompletas de la categoría pendiente
  de cohorte; lista general conserva por_agendar/reservado con etiquetas españolas.
  Usuario con varias matrículas: matchingEnrollments debe respetar todos los filtros.
  SQL061 solo si necesario, RLS/ACL/rollback y arnésF45; no tocar058 ya entregada.
- I04/I13: IC409 concurrente al reducir cupo devuelve409/código estable y frontend
  muestra capacidad inferior a matrículas y reservas vigentes, sin errores técnicos.
- I10: users.status cambia verificado→activo solamente tras pago confirmado y dentro
  de la misma transacción. Duplicado/webhook tardío/rechazado/pendiente no activan;
  rollback en cualquier escritura revierte estado de usuario, matrícula y franjas.
  Revisar todas las guardas por users.status; activo boolean mantiene su significado
  de cuenta habilitada. Manuales y registros existentes conservan comportamiento.

## I03 — guarda central y estado
- Matriz de todos los routers autenticados como alumno por_agendar/reservado vs
  manual/existenteactiva/admin/instructor; exámenes, intentos, franjas, calificaciones,
  historial, usuarios y matrícula deben bloquear403 antes de consultar datos ajenos.
- Solo métodos y paths exactos de allowlist; query/trailing slash/UUID inválido,
  rutas parecidas o prefijos inyectados no amplían excepciones. Notificaciones own.
- Inactivo/debe_cambiar_password se validan antes de etapa; JWT app_metadata de
  alumno sin perfil no entra. Errores DB503 y no401 ni acceso por defecto.
- Varias matrículas: una incompleta restringe toda cuenta; manuales/sin matrícula
  legacy conservados. Datos propios por JWT, no studentId del cliente.
- Estado antes/reservado/vencido/activo, expiraAt/serverNow, puedePagar solo con
  reserva vigente en solicitud; no_sabe restaurado desde solicitud, exención65,
  fecha primera práctica propia/cohorte correcta, null sin prácticas.
- Pérdida de conexión/columna058 ausente/fallo de docs o request503 en español,
  sin SQL/PII en logs. Otros routers no eluden guarda por autenticación duplicada.
- No ejecutar suites: solo typecheck/lint fuente; revisar HTTP/abuso en fase final.

## I04 — rutas, menú y paso1
- Proxy: cuenta incompleta redirige desde cualquier /student/* a /student/inscripcion
  salvo cambio de contraseña; conservar cookies renovadas. Error API/red/schema503
  no concede acceso; no consultar ni enviar tokens de otro usuario.
- Layout alumno obtiene estado servidor autenticado, sin token serializado; menú
  desktop/móvil incompleto muestra Mi inscripción/contraseña, campana y logout;
  manual/existentes conservan menú completo. Cambio manual de URL no evita backend.
- Paso1 renderiza verificaciones, sangre declarada/no_sabe, checklist y exenciones65;
  requisitos pendientes impiden Siguiente, no se solicita archivo. Stepper teclado,
  aria-current, lector de pantalla y 375/768/1280 claro/oscuro.
- Datos propios/503/reintentar, recarga con reservado, usuario activo vuelve a panel.
  Paso2 es punto de integraciónI09; Paso3 se completa enI12, no se inventan horarios.
- Alumnos muestra Por agendar/Reservado sin etiquetar pendiente de cohorte; ajuste
  p_pending en SQL061(I13) sigue pendiente para no alterar058 ya entregada.
- IC409/COHORT_CUPO_BELOW_ACTIVE muestra aviso español junto a cupoMaximo, enfoca
  campo y ofrece recarga como otros409. No modificar otros flujos de Cohortes.
- Tests previos de Sidebar/proxy/layout requieren adaptar mocks de account-status;
  no se modificaron ni ejecutaron, registrar en fase final.

## I05 /059
- SQL: RLS/ACL reales y SET ROLE anon/authenticated; privilegios de extensiones
  idénticos antes/después; faltan dependencias, rollback con datos se niega intacto.
- Dos conexiones: último cupo, misma franja/instructor, reservar contra wizard
  manual/edición/practice scheduler; ni sobrecupo ni solape; timeout/deadlock
  traducidos sin repetir mutación. A→B con cohortes múltiples sin espera infinita.
- Tiempo Guayaquil medianoche, TTL/extensión/pago tras esperar locks; cron apagado,
  holds vencidos se reutilizan incluso antes de cerrar cabecera. Extensión una vez,
  pago repetido no añade gracia, alumno no libera pago_en_curso.
- Reserva propia, matrícula ajena/manual/ya activa, alumno inactivo/eliminándose,
  horas exactas curso, última sesión parcial,6h/día máximo, límites06–22/modalidad.
- Cohorte primera por inicio, margen5 límite exacto, matrícula abierta hoy, todas
  las prácticas contenidas. Cambio de precio/fecha/curso con holds rechazaIR413.
- Contador3 exitosas/día no se reinicia al liberar/vencer, fallos no consumen.
- Expiración una notificación, libera matrícula/cupo/leases, no cierra sesión.
- Desactivar libera reservas/pago_en_curso, eliminación026 cascade no bloquea;
  prácticas pagadas mantienen recuperación025. Instructor inactivo se sustituye.
- Confirmación privada pre-pago rechaza; repetida no duplica prácticas; llegada
  tardía con slot/cupo robado debe pasar a revisión atómica enI10.

## I06
- Calendario compartido con wizard manual: lunes/domingo, inicio en día no válido,
  15h con1/2/4/6h por día y último día parcial;06–22, máximo365d de inicio,
  curso sin horas/error DB, cuenta ajena/manual/activa/sin verificaciones.
- Disponibilidad oculta instructores, montos y cohortes previas a confirmar; solo
  booleanos por celda. Cohorte cubre todo el plan, margen5 inclusivo y matrícula
  abierta hoy Guayaquil; cupo activo+holds; variascohortes orden por inicio/id.
- Franjas físicas incluso libre/disponible ocupan instructor como antes; holds
  vigentes/vencidos; solape propio en otra matrícula/inicio a mediahora.
- Reserva revalida cada fecha/hora/día/total sin aceptar cohorte/instructor/precio,
  array duplicado/infinito/datos desconocidos. Disponibilidad obsoleta→409 estable.
- Config vacía/default/inválida/bordes; TTL≤15,ext≤1x10,día≤3,gracia≤10.
- Manual/cohortas traducen IR409/IR413/IC409/deadlock sin exponer detalles;
  errores de red/devuelta solo códigos técnicos en logs; sin reintento de escritura.

## I07
- JWT ausente/caducado/rol alumno alterado/instructor/admin, perfil inactivo y
  debe_cambiar_password; allowlist acepta SOLO cinco rutas propias de reserva.
  Exámenes/ratings/history/otras rutas continúan403 INSCRIPCION_INCOMPLETA.
- GET actual sin reserva/vigente/pago_en_curso/vencida/confirmada; expiraAt/serverNow
  de SQL. Ampliar/liberar caducada devuelve estado y limpieza persistida, no500.
- Matrícula y reserva ajenas no retornan datos; cuerpos desconocidos/cohorte/
  instructor/precio/studentId prohibidos; query no admitida; UUID/fecha bisiesta/
  arrays/número string/slots duplicados/horas inválidas y request >100KB rechazados.
- POST reservar201, resto200; límites por alumno (180lecturas,12reservar,20acciones/
  15min), dos alumnos mismaIP independientes; diario3/ampliación1 persistentesSQL
  incluso entre instancias. Concurrente2reservas: una gana, otra409.
- Timeout/red de DB503, errores técnicos no exponen PII; frontend conserva JWT/MFA
  global; no rutas públicas ni endpoint para empezar pago hastaI11.

## I08
- Con DISABLE_CRON=true, GET estado/account-status/actual, disponibilidad, reservar
  y ampliar/liberar limpian vencidas y devuelven estado correcto, lease no ocupa
  instructor ni cupo incluso antes de limpieza. No pérdida de solicitud/sesión.
- Cron cada minutoGuayaquil, máximo100 cabeceras/5alumnos concurrentes, relojSQL
  decide; dosinstancias+vía perezosa generan exactamente un aviso/evento por reserva.
- Cron lento no se solapa consigo mismo, DBerror contabiliza fallos y reintenta
  la siguiente vuelta, logs solo totales/códigos; lista paginada prioriza vencidas.
- Cron apagado no se programa; pago_en_curso respeta gracia; extender justo
  al borde/caducidad mientras confirma pago: solo un estado atómico válido.
- Advertencia5min/expiración frontendI09 y aviso de bandeja propio, sin correo.

## I09
- Selector teclado/móvil/lector: modalidad entresemana/finsemana, inicio y1–6h;
  cuadrícula16filas06–22 y días del motor; selección exacta, último día parcial,
  casilla ocupada/desmarcar/máximo por día; no instructor ni precio antes del pago.
- Cambiar parámetros invalida disponibilidad/selección, aborta consulta anterior,
  respuesta tardía ignorada;400/403/409/429/503/networktimeout con mensaje español
  y reconsulta. Reserva incierta→consultar estado antes de otra mutación.
- Refresh/reingreso mantiene reserva/cohorte/plan del servidor; contador visible
  en los3pasos, hora local cambiada no lo alarga, resync30s/foco/visibilidad,
  aviso≤5min, ampliar una vez actualizaexpiraAt, pago_en_curso no permite cambios.
- Cero local bloquea pago y pregunta aSQL; solo estado vencida muestra banner y
  devuelvePaso2, conserva solicitud/sesión; cron apagado, expirar en otra pestaña.
- GET iniciado antes de ampliar/reservar no pisa respuesta nueva; dobleclick
  protegido en cliente ySQL; ampliar/redfallida conserva contadorautoridad.
- Liberar pide confirmación, conserva contador diario; recargar trasliberada.
  Reserva liberada/vencida ajena rechazada; UI no llama endpoints de otros roles.
- Pago sigue sin habilitar hastaI12; botón continuar lleva alPaso3 informativo
  sin tarjetas/credenciales de prueba ni montarcheckout ficticio.
- I09 integración dos matrículas propias incompletas: el estado prioriza la
  reservada para que documentos/enrollmentId/cohorte del wizard coincidan con
  la única reserva por alumno. Tras liberar/vencer vuelve al pendiente principal.
- I12/I13: pago confirmado desde otra pestaña/admin debe recargar estado y layout
  para menú completo; no implementar checkout hasta las tareas de fase3.

## I10 /060
- Aplicación con059ausente/esquema payments ajeno, preflight sin efectos y
  rollback con intentos se niega; ACL/RLS con roles reales, extensiones intactas.
- Dos conexiones: doblebegin mismoUUID; claves cruzadas/propiedad; dos intentos
  misma matrícula; claimdispatch único, redincierta no reenvía cobro.
- Importe siempreDB: cambio precio/cupo, recargo0/positivo/bordes, IVA0explícito,
  recibido distinto/moneda distinta→revision o422 segúnresultado.
- Aprobación atómica incluye users.status verificado→activo + matrícula/abono/
  horas/franjas/pago/aviso/outbox. Error en medio no deja acceso parcial.
- Llegada tardía libre recupera; ocupada/cupo nuevo/pago paralelo/reserva nueva/
  instructor inactivo/usuario desactivado o eliminándose retiene dineroenrevision.
- Webhook repetido igual no duplica; mismoeventkey otrohash/pago/resultado409,
  referencia de proveedor repetida no adjudica dinero a otro alumno.
- Efectivo estudiante/instructor/anon denegado, adminactivo/MFA permitido,
  comprobante opcional textual saneado. Liberar con pago pendiente/recibido deniega.
- Rechazo permite reintento sin renovar gracia ni ampliar; pendiente no libera
  ni concede acceso; duplicado aprobado/rechazado fuera deorden no revoca acceso.
- Outbox claim exclusivo/caducidad5intentos/CAS token; caída trasSMTP puede repetir
  correo con mismoMessage-ID, nunca dinero/franjas.
- Eliminar alumno con pendiente/aprobado/revision409ANTES de ban/Storage; alumno
  sinpagos/solo rechazados conserva026 y ledger rechazado anónimo conFKNULL.
- Ver todas las guardas de perfil/status con pago y cuenta administrativamente
  inactiva: no se evade conJWT viejo ni un cambio de status por frontend.

## I11
- Configsimulado explícito enproduction debe negar arranque; manual/kushki conviven,
  secretos requeridos soloKushki; recargoentero/nombresproveedor inválidos fallan.
- Propiedad JWT en crear/consultar/simular; solo adminactivo/MFA registra efectivo
  o libera reserva; precio/moneda/cohorte/instructor/PAN/CVV desconocidos rechazados.
- Webhook firma fuerte cuerpo.timestamp, comparisonconstante, merchant/timewindow,
  evento/hash persistentes/replay, esquema/monto/moneda; sin SimpleSignature sola.
- Redincierta al cobrar queda pendiente y no repite dispatch; webhook antes/después
  de respuesta, reintentos3h, referencia ajena, firma inválida, aprobado tardío.

## I12
- Paso3 importe/recargo/IVA/total soloDTOservidor; se congela intento antes de
  tokenizar. Actualpor matrícula propia (dos cursos) y GETajeno404.
- Simulado: aprobado→cuenta/menú completos, rechazado→nuevointento sin gracia
  extra, pendiente→recargar/pollear sin cobro duplicado, revision→no otro pago.
- Redincierta alcrear/cobrar: mismoattemptUUID, consulta estado y no nuevo
  dispatch; puederCobrar false después del envío incluso al recargar.
- HostedFields SDK1.10.0: import soloPaso3/Kushki, iframeUAT/producción, sin
  InputPAN/CVV propio ni localStorage/logs; solo token albackend. OTP/3DS, errores,
  cargafallida/reintento, StrictMode/unmount, dosinstancias/selectores únicos,
  cuotaexacta/monedaUSD, CSPReportOnly por página y certificación real pendiente.
- Éxito desde otrapestana/admin/webhook refresca estado/layout y menús. Pago
  pendiente sobrevive vencimiento/retornoPaso2 con banner para consultar; estados
  de otrocurso no pisan el principal; GETviejo no sobreescribe mutación nueva.
- Admin efectivo muestra cotización, confirmación, comprobanteopcional saneado,
  dobleclick/timeout conservaUUID y no duplica; reserva vencida o pago pendiente
  impide liberar/cobrar, actor sinrol/MFA denegado; ficha se refresca almutar.
- Correo bienvenida soloaprobado, SIN contraseña/enlaceAuth, Message-IDestable,
  console no redSMTP; falloSMTP no fallaHTTP de pago, outboxlease2min/CAS/retry5min
  máximo5; cronapagado funciona vía aprobación/GETpropio.
- Webhook previo aún concilia con claves válidas si se cambia PAYMENT_PROVIDER a
  manual; no acepta sinfirma/claves/merchant y no duplica correo/contabilidad.
- Validar que scriptsSDK/telemetría/3DS solo reciban datos permitidos, sin
  incluir secreto/token en errores. No se hicieron llamadas de cobro ni ensayos HTTP.
## I13 /061
- p_pendingtrue solo manual/legacyactiva pendiente_cohorte; false soloetapaactiva
  nopendiente; sinfiltro incluye poragendar/reservado conbadges. Búsqueda, varias
  matrículas poralumno, filtroscombinados/historial/paginación y resumencupo intactos.
- Preflighthuella distinta falla sin cambios, reaplicar061 no cambia datos,
  rollback restaura filtro sin eliminar filas; ACL solo backend conactoradmin.
- Pago060/GET desdeotrasesión refresca menú completo; JWTviejo con perfilinactivo
  sigue403; dosmatrículas incompletas exigen cerrar ambas antes de accesoacadémico.
- Horarios muestraTODAS las propias asignadas coninstructor (sin instructor antes
  delpago ni franjas de otrosalumnos); confirmación/asistencia/reprogramación
  conserva límites; historialpropio y objetivo15h sin contarhoras noasistidas.
- Documentos primera práctica Guayaquil conUTC/fecha cambiada/reprogramación/
  sinpráctica/completada, exención65, no_sabe resaltado; sin botón de subir.
- IC409 en reducción cupo conholdvivo: mensajeespañol y foco campocupo; vencido
  nolocuenta. Manuales/existentes conservados sin migración de estado/importes.

## I10/I11 — ampliación 062 y dispatch simulado
- Abandonar antes de tokenizar: al vencer lease, pendiente sin dispatch pasa a
  rechazado, motivo NO_ENVIADO_VENCIDO y un único evento; nueva reserva/pago posible.
- Dos conexiones: expiración vs claim con el mismo alumno; nunca cancelar después
  de dispatch ni enviar tras lease vencido. Intento manipulado de otra cuenta no
  envía, reserva con clase ya pasada no permite cobrar. SQL rollback conserva ledger.
- Pendiente enviado simulado/Kushki vence reserva pero no cancela dinero incierto;
  resultado tardío libre activa, ocupado queda en revisión. Simulado pendiente se
  resuelve después del TTL y no se confunde con checkout vacío. Doble claim no duplica.
- Efectivo durable con respuesta perdida se reanuda con el mismo UUID/admin actor;
  no caduca por la regla de checkout vacío y no se permite otro cobro paralelo.

## I14 — documentación y aceptación final (pendiente por autorización)
- Recorrer el guion manual del runbook de backend y la guía del frontend con correo
  console y simulado; contratos HTTP/códigos reales, roles, refresh y red fallida.
- UAT del comercio con Hosted Fields, OTP/3DS, CSP, firma webhook y sus reintentos;
  nunca usar ni publicar tarjeta/clave real. Ensayos fuera del arnés aún no ejecutados.
- Validar despliegue coordinado 058→062, preflight/rollback con datos persistentes,
  RLS/ACL reales y Realtime privado; el arnés no certifica la configuración remota.
- Definir IVA y política de conservación/conciliación financiera antes de producción.
  F43 y fase final de pruebas siguen expresamente aplazadas; no dar por validados
  navegador, carreras entre conexiones ni proveedor/correo real por un build exitoso.

## Corrección pre060 I10/I11 — cero, ticket y correlación
- SQL F45 ampliado y ejecutado: pendiente/rechazo con cero y moneda distinta,
  rechazo sin ticket con/sin referencia guardada, sintética reemplazada por HTTP
  tardío, replay sin IP409 y reserva vigente sin ampliar expira_at; aprobación
  discordante en revisión. Entradas LF y copia CRLF058–062, sin SQL remoto.
- Pendiente para fase autorizada: parser firmado DECLINED request_amount primero
  vs APPROVAL approved_transaction_amount primero, cero/strings/negativos y límites.
- Webhook sin metadata, metadata no objeto, UUID inválido/no existente: lookup por
  ticket solo proveedor kushki. Sin coincidencia202 sin RPC/escrituras ni PII en log;
  volver a intentar después de guardar referencia HTTP debe procesar una sola vez.
- APPROVAL sin ticket sigue400; DECLINED sin ticket con UUID válido pasa NULL a SQL.
  Sin ambos identificadores202; firma/merchant/timestamp inválidos nunca consultan
  ni mutan pagos. Ticket real ajeno no se reemplaza ni activa un intento distinto.
- Carrera entre HTTP y rechazo sin ticket, ambos órdenes: referencia real conservada
  o sintética propia actualizada; sinIP409 por el fallback ni duplicación de eventos.
  Esto exige dos conexiones/HTTP y no queda acreditado por F45 secuencial.
- Reportes tardíos no aprobados conservan estado final; recibido_* guarda el último
  reporte nuevo, total esperado intacto. Nuevo aprobado discordante conserva revisión.

## I15 — hora fija y plan automático (pendiente, no se escribieron pruebas)
- Plan de 15 horas con 1, 2, 3 y 6 horas por día: 15, 8, 5 y 3 días; último día parcial
  (2 h/día → 7×2+1; 6 h/día → 6, 6, 3). Bloques consecutivos desde la hora de inicio.
- Fecha de inicio en sábado/domingo con entre_semana (y entre semana con fin_de_semana):
  primer día = siguiente día válido, `ajustada` true, `fechaInicioEfectiva` correcta.
- Hora de inicio que no termina antes de las 22:00 (p. ej. 17:00 con 6 h; 22:00; 5:00; 7.5;
  texto): HORA_INICIO_INVALIDA; opciones solo lista 06..22−horas.
- Fecha de inicio hoy, pasada, >365 días, 2026-02-31, formato inválido: FECHA_INICIO_INVALIDA.
- Instructor faltante un día: opción no factible con ese día en diasFallan; vista previa
  marca el día; reservar responde PLAN_NO_FACTIBLE con `detalles.dias`.
- Prácticas propias solapadas: día con motivo SOLAPE_PROPIO.
- Cohorte que no alcanza el margen de 5 días (fin −5 antes de la última fecha), sin cupo o
  con matrícula cerrada: SIN_COHORTE_ELEGIBLE con `primeraFechaPosible` coherente.
- POST /reservas con `franjas` (aun vacío o con otras claves): 400 FRANJAS_NO_PERMITIDAS;
  también en /horario/opciones y /horario/plan; campos extra: INVALID_FIELD.
- Reserva ya existente: RESERVA_YA_EXISTE; GET /reserva devuelve `plan` derivado (hora,
  horas por día, días) coherente con las franjas; liberar y volver a reservar.
- Una sola llamada a student_schedule_free_slots por consulta de opciones (lote).
- Carrera: instructor ocupado entre vista previa y reserva → HORARIO_NO_DISPONIBLE (SQL).
- Ruta eliminada POST /disponibilidad responde bloqueada/404 y no está en la lista permitida.
