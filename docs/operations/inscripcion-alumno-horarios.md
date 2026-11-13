# Motor de horario del alumno (I06)

## Hora fija y plan automático (I15)

El alumno elige solo cuatro datos: modalidad (entre_semana o fin_de_semana), fecha de
inicio, horas por día (1–6) y hora de inicio (entera, 06–21). El servidor calcula el
plan con `src/utils/studentFixedPlan.ts`, función pura y determinista:

- totalHoras = `courses.horas_requeridas` de la matrícula (10 en planes nuevos; las matrículas anteriores mantienen su objetivo individual).
- Días: desde la fecha de inicio, solo los de la modalidad (lunes a viernes, o sábado
  y domingo). Si la fecha elegida no es un día de la modalidad, el primer día es el
  siguiente válido y la respuesta lo informa (`ajustada`, `fechaInicioEfectiva`).
- Cada día empieza a la MISMA hora y dura min(horasPorDia, horas restantes), en bloques
  de 1 hora consecutivos. Ejemplo: 07:00 con 3 h/día y 15 h = 5 días de 07:00 a 10:00;
  con 6 h/día son 3 días (6, 6, 3).
- Debe terminar a más tardar a las 22:00 (inicio + horas del día ≤ 22) y la fecha de
  inicio va de mañana a 365 días, en America/Guayaquil. **Limitación: no se consideran
  feriados.**
- Cohorte (cupo, matrícula abierta hoy, ventana del curso y margen COHORT_MARGIN_DAYS=5),
  instructor libre por franja (asignación automática, nunca visible) y ausencia de
  solapes con las prácticas propias del alumno se mantienen.
- Un plan con algún día sin instructor es NO factible y se informa qué días fallan.

Las opciones y la vista previa calculan todas las franjas candidatas y consultan
`student_schedule_free_slots` UNA vez en lote (más una consulta de prácticas propias).
Nunca retornan IDs ni nombres de instructores, datos de otro alumno ni precio; sí la
cohorte tentativa (id y nombre) del propio curso, que se confirma al reservar.

La reserva recibe SOLO `{enrollmentId, modalidad, fechaInicio, horaInicio, horasPorDia}`,
recalcula el plan y llama a la RPC 059 sin cambios (que vuelve a validar fechas, horas
por día, cohorte, cupo e instructor por franja bajo lock). Una lista `franjas` enviada
por el cliente se rechaza con 400 `FRANJAS_NO_PERMITIDAS`. La hora de inicio y el plan
se derivan de las franjas retenidas (campo `plan` de la reserva); no hay cambios de
modelo de datos. No se repiten mutaciones automáticamente ante timeout/deadlock/conflicto.

Variables backend, todas opcionales sin secretos: RESERVA_TTL_MINUTES15(1–15),
RESERVA_MAX_EXTENSIONES1(0–1), RESERVA_EXTENSION_MINUTES10(1–10),
RESERVA_MAX_POR_DIA3(1–3), PAGO_GRACIA_MINUTES10(1–10),COHORT_MARGIN_DAYS5(0–60).
Las cotas SQL059 impiden aumentar las primeras cinco más allá del contrato de abuso;
para ampliarlas hay que acordar un cambio de negocio/migración. `.env` local intacto.

El precio/curso/fechas de cohorte con holds vivos no se puede cambiar de forma
incompatible (IR413→COHORT_CON_RESERVAS,409). El manual recibe conflicto español
si una franja se ocupó entre sugerencia y confirmación. IC409 conserva su traducción
para cupo inferior a matrículas y reservas vigentes.

I07 publica las rutas propias y límites; I09 consume este contrato en el selector;
I10/I11 son los únicos dueños de comenzar pago/confirmar, aún sin endpoint de pago.

## Rutas propias (I07)

Todas bajo `/estudiantes/inscripcion`, con JWT/rol estudiante y cuenta activa,
contraseña vigente y propiedad derivada del JWT; ninguna recibe studentId.

| Método/ruta                | Entrada / resultado                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /horario/opciones     | enrollmentId,modalidad,fechaInicio,horasPorDia; horas de inicio posibles con factible/motivo/diasFallan, cohorte o sinCohorte, fechaInicioEfectiva |
| POST /horario/plan         | los anteriores +horaInicio; vista previa de solo lectura: días, última fecha/hora, horasTotales, cohorte tentativa, factible                       |
| POST /reservas             | enrollmentId,modalidad,fechaInicio,horaInicio,horasPorDia; 201 con reserva y `plan` derivado, sin instructor. Rechaza `franjas`                    |
| GET /reserva               | sin parámetros;200 {reserva:null o última propia,serverNow}                                                                                        |
| POST /reservas/:id/ampliar | UUID propio y cuerpo vacío;200 {reserva,serverNow}                                                                                                 |
| POST /reservas/:id/liberar | UUID propio y cuerpo vacío;200 {reserva,serverNow}                                                                                                 |

`POST /disponibilidad` (cuadrícula día×hora) se eliminó. Códigos estables nuevos:
`PLAN_NO_FACTIBLE` (409, `detalles.dias` con las fechas que fallan), `SIN_COHORTE_ELEGIBLE`
(409, `detalles.primeraFechaPosible`), `HORA_INICIO_INVALIDA` (400), `FECHA_INICIO_INVALIDA`
(400) y `FRANJAS_NO_PERMITIDAS` (400). `RESERVA_YA_EXISTE` y los demás se conservan.

UUID/fechas/números/arrays validados, campos extra y query prohibidos. JSON100KB (límite global existente). `INVALID_FIELD`400 es
error estructural; códigos de negocio en studentScheduleError.ts. Vencida se devuelve
explícitamente para que la UI regrese al selector: no se revierte limpieza por error.
GET devuelve también la última cerrada para recuperar el aviso tras recargar; una
reserva confirmada es historial, no un nuevo permiso para pagar.

Allowlist de I03 se amplía únicamente para estas rutas; cualquier otra sigue
bloqueada antes de acceder al router. Limites por alumno autenticado/HMAC:180lecturas,
12reservar,20ampliar/liberar por15min; los dos últimos tipos comparten su contador.
Son protección adicional de proceso (tests la omiten como los límites existentes).
El máximo diario3 y ampliación1 son persistentes y atómicos en SQL, también con
varias instancias. No hay endpoint público ni de iniciar pago hastaI11.

## Expiración conectada (I08)

Estado-inscripcion limpia sus reservas antes de leer. Account-status/guarda limpia
si detecta etapa reservado; disponibilidad/reservar limpian antes de validar, y la
RPC de actual/ampliar/liberar también lo hace bajo lock. Ninguna operación depende
del cron para considerar libre un lease vencido ni para permitir reservar otra vez.
El cierre atómico deja por_agendar, conserva solicitud/cuenta, libera cupo y franjas,
añade evento y un aviso en bandeja. No envía correo al vencer.

Cron cada minutoGuayaquil, solo si DISABLE_CRON no es true. Revisa las100 primeras
cabeceras por vencimiento, sin confiar en el relojNode: SQL decide cuáles caducaron.
Procesa5 alumnos en paralelo, falla por alumno sin interrumpir el lote, registra
solo cifras/códigos y no se solapa consigo mismo. Instancias múltiples se serializan
por usuario en SQL. Con más de100 pendientes hay limpieza gradual, pero todas las
vencidas YA dejan libre cupo/calendario; el siguiente lote y las lecturas completan
los avisos. Un fallo DB permite reintentar la siguiente vuelta y falla cerrado en
la consulta del alumno. No hay llamadas de red/correo dentro de una transacciónSQL.

## Selector y contador (I09)

`/student/inscripcion` integra (I15) modalidad y horas por día como controles
segmentados, fecha de inicio y la hora de inicio como fichas (las no factibles quedan
deshabilitadas con su razón). El plan resultante se muestra en solo lectura, sin
casillas clicables; los días sin instructor se marcan y bloquean "Reservar este
horario". Cambiar parámetros aborta la lectura anterior y descarta respuestas
tardías. Un error al reservar obliga a consultar antes de otro intento.
No hay persistencia de selección/cohorte/instructor/monto en localStorage.

Con la reserva vigente muestra cohorte y plan completo en solo lectura, sin instructor.
Con varias matrículas incompletas el estado prioriza la reservada para que el Paso1
coincida con la única reserva vigente. GET propio recupera el plan tras recargar.
Liberar exige confirmación y advierte que el intento diario se conserva.

Banner/contador visible en los tres pasos, también durante errores/carga del estado.
Se ancla a serverNow/expiraAt y avanza con reloj monotónico, resincroniza cada30s y
al volver a la pestaña/foco. Aviso de5min; ampliación única solo si SQL la permite.
Al llegar a cero bloquea continuar y consulta al servidor: no declara vencimiento ni
libera localmente. Al recibir vencida muestra aviso y vuelve al Paso2 sin perder
solicitud/sesión. Una lectura anterior no pisa la respuesta de ampliar/reservar.
Ante red incierta conserva información y ofrece consultar el estado; no repite una
mutación automáticamente. Pago en curso impide cambiar/liberar desde alumno.

El Paso3 aún es informativo hastaI12: no hay checkout ni cobro falso. I10 debe
confirmar users.status verificado→activo y matrícula/franjas/pago en una transacción;
I12/I13 recargarán estado/layout tras pago, también desde otra pestaña/admin.
No se cambiaron estilos globales, tokens ni componentes compartidos enI09.

Cierre fase2: source typecheck/lint tocado OK, build backend OK y build frontend de
aplicación webpack OK. Para frontend se excluyeron temporalmente tests heredados
(9 errores TS conocidos) y .claude del build, con tsconfig restaurado sin diff y
variables públicas ficticias solo en el proceso. No se ejecutaron ni editaron tests.
Solo059 se comprobó con arnésF45 autorizado; no se aplicó SQL remoto.
