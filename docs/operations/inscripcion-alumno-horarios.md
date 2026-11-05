# Motor de horario del alumno (I06)

El backend recibe solo modalidad, inicio y horasPorDia1–6. El calendario usa
`PracticeSlotGenerationService.sessionDates`, el mismo generador civil del wizard
manual. El número de días es ceil(horas_requeridas/horasPorDia); el último día se
recorta al número exacto de horas. Cada celda es una hora entera06–22. Se admite un
inicio hasta365 días adelante; los cursos deben tener1–500 horas configuradas.

Disponibilidad consulta solo la matrícula propia pendiente, verificada, de origen
solicitud. Busca cohortes del mismo curso abiertas HOY en Guayaquil, con cupo real,
y que contengan TODO el calendario y margen configurado al final. Si no caben todos
los días no se muestran franjas seleccionables. La disponibilidad por lote usa el
mismo `practice_free_instructors` del manual: cuenta instructor activo, franjas
físicas ocupadas y holds vigentes; filtra también solapes del propio alumno. Nunca
retorna IDs/nombres de instructores, datos de otro alumno, precio ni cohorte antes
de reservar. Las sugerencias de fecha son orientativas, requieren nueva consulta.

El alumno puede elegir horas diferentes cada día. El servidor vuelve a construir el
calendario y exige la cantidad exacta por día/curso, sin repetidas ni fuera de06–22.
La RPC059 elige la primera cohorte por inicio/id bajo lock, y un instructor libre
por franja con el helper compartido. El alumno nunca selecciona esos IDs ni montos.
No se repiten mutaciones automáticamente ante timeout/deadlock/conflicto; se invita
a consultar el estado antes de reintentar. Reservar/extender/actual limpiar vencidas
no depende del cron (I08 conecta además el estado general y el trabajo por minuto).

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

| Método/ruta                | Entrada / resultado                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| POST /disponibilidad       | enrollmentId,modalidad,fechaInicio,horasPorDia; celdas booleanas/fechas sugeridas/serverNow |
| POST /reservas             | los anteriores +franjas[{fecha,hora}];201 con reserva sin instructor                        |
| GET /reserva               | sin parámetros;200 {reserva:null o última propia,serverNow}                                 |
| POST /reservas/:id/ampliar | UUID propio y cuerpo vacío;200 {reserva,serverNow}                                          |
| POST /reservas/:id/liberar | UUID propio y cuerpo vacío;200 {reserva,serverNow}                                          |

UUID/fechas/números/arrays validados, campos extra y query prohibidos. Selección
máximo500 bloques y JSON100KB (límite global existente). `INVALID_FIELD`400 es
error estructural; códigos de negocio en studentScheduleError.ts. Vencida se devuelve
explícitamente para que la UI regrese al selector: no se revierte limpieza por error.
GET devuelve también la última cerrada para recuperar el aviso tras recargar; una
reserva confirmada es historial, no un nuevo permiso para pagar.

Allowlist de I03 se amplía únicamente para estas cinco rutas; cualquier otra sigue
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

`/student/inscripcion` integra selección de modalidad/inicio/horas por día, tabla
horizontal día×hora con botones accesibles y estados Libre/Elegido/Ocupado. Cada día
exige su cuota y el último se recorta; el servidor decide las horas totales del curso.
Cambiar parámetros invalida celdas y selección, aborta la lectura anterior y descarta
respuestas tardías. Un error al reservar obliga a consultar antes de otro intento.
No hay persistencia de selección/cohorte/instructor/monto en localStorage.

Después de reservar, muestra cohorte tentativa y plan completo, sin instructor.
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
