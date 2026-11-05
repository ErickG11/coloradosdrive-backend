# I05 — reservas temporales (059)

MANUAL:057 aplicada →058 etapas →059 reservas →060 pagos. No ejecutar SQL remoto
con herramientas del asistente. Primero preflight059; después migración, verificación
con ROLLBACK y aplicación manual autorizada del operador. No cambia matrículas antiguas.

## Modelo

`student_schedule_reservations` conserva una cabecera por intento y estado vigente,
pago_en_curso, liberada, vencida o confirmada. Índice único permite solo una cabecera
vigente/pago_en_curso por alumno. `student_schedule_daily` cuenta intentos exitosos por
fecha civil de Guayaquil, máximo3; liberar o vencer no devuelve intentos. Un fallo
atómico no consume contador. FK del alumno/matrícula elimina cabeceras, holds, eventos y
contador junto al flujo026; la auditoría administrativa de eliminación sigue en026.
`student_schedule_events` registra acciones sin nombres, correos ni cédulas.

`student_schedule_holds` representa bloques de1h, sin filas definitivas en practice_slots.
Exclusión GiST por instructor + intervalo de clase + intervalo del lease: al vencer el
lease deja de colisionar incluso sin ejecutar limpieza. No usa `now()` en un índice ni
altera funciones de btree_gist. El instructor solo figura internamente. La respuesta
JSON muestra fechas, cohorte tentativa, id propio, estado, extensiones, expiraAt/serverNow.
Ningún instructor se serializa; I13 revela el instructor de las prácticas ya pagadas.

Valores máximos SQL defensivos: TTL15min,1 ampliación de10min,3 reservas/día y gracia
de pago10min. Backend I06/I07 los configura y pasa; no acepta valores del navegador.
La gracia conserva el vencimiento si ya es posterior a ahora+10min. Iniciar pago dos
veces no amplía dos veces. Tras empezar pago no se puede ampliar ni liberar desde alumno.
I10 coordina resultado/rechazo/pago tardío; no habilitar un checkout antes de060/I11.

## Autoridad y concurrencia

`reserve_student_schedule` valida cuenta activa/rol/propiedad/no eliminación,
verificaciones, origen solicitud/por_agendar, curso/horas, fechas civiles de modalidad,
horas por día1–6 y bloques enteros06–22. La última sesión puede tener menos horas.
No confía en curso/cohorte/instructor/monto del navegador.
Supuesto R3: TODAS las prácticas están dentro del rango de UNA cohorte del mismo curso,
matrícula abierta hoy Guayaquil y última práctica no posterior a fin_curso menos margen
(default5 días). Se elige la primera cohorte elegible por fecha_inicio_curso,id. Los
cupos cuentan matrículas activas y reservas vigentes con helper058 y lock FOR UPDATE.
La lectura de disponibilidad es informativa: reservar revalida todo tras esperar locks.

Orden: usuario → matrículas propias ordenadas → reserva → cohorte → coordinador de
calendario. El coordinador es un advisory xact lock breve compartido por reservas,
confirmación y toda INSERT/UPDATE física de practice_slots. El trigger físico toma
cohorte KEY SHARE antes del coordinador para no invertir con cupo. SQL siempre puede
rechazar una carrera/deadlock/timeout: I06/I07 debe traducirla a conflicto reintentable,
sin repetir automáticamente una mutación. No hay llamadas de correo/pago/red bajo locks.
La sugerencia manual practice_free_instructors conserva su filtro/orden original y
excluye holds vivos. Las franjas físicas disponible/liberado también ocupan calendario
como antes (no se reclaman silenciosamente para otra cohorte).

Liberar/vencer resta cupo, cambia matrícula a por_agendar y libera leases en una sola
transacción. No necesita lock de cohorte para restar. Desactivar al alumno cierra su
reserva en el mismo UPDATE de activo, sin tocar la recuperación025 de clases pagadas.
Desactivar instructor sigue permitido antes de pago; confirmar busca un sustituto libre
si el original ya no es elegible. Cambiar precio/curso/fechas incompatibles de una cohorte
con reservas vivas se rechaza IR413. Instructores históricos referenciados no se borran.

`expire_student_reservations` limpia por alumno bajo locks. I08 añadirá cron por lotes y
lo invocará en lecturas/operaciones; cupo y sugerencias YA ignoran leases vencidos. Cada
cierre vencido inserta exactamente un aviso en bandeja (`cambio_realizado`, sin email).
Acciones de manage que detectan vencimiento devuelven el estado vencido sin lanzar una
excepción que revierta la limpieza. El controlador I07 traduce ese resultado al cliente.

`private.confirm_student_reservation` solo se invoca en la MISMA transacción futura de
I10, después de activar usuario/matrícula, con locks de cupo tomados por I10. No activa
cuentas ni cobra. Conversión idempotente libera su lease e inserta prácticas asignadas;
una llegada tardía vuelve a comprobar disponibilidad y puede sustituir instructor, nunca
fechas ni cohorte. Falla IR409 si no cabe. I10 debe atrapar ese conflicto en subtransacción
y conservar el pago en revisión/aviso admin; nunca perder dinero ni activar parcialmente.
I10 también validará precio, estado de cuenta, cupo, margen y fecha antes de activar.

## Seguridad y recuperación

Todas las tablas tienen RLS, sin políticas ni permisos de PUBLIC/anon/authenticated.
Funciones propias SECURITY INVOKER/search_path vacío, EXECUTE solo service_role, también
las internas private. No se tocan extensiones, Realtime ni Storage. El backend deriva
p_student del JWT, valida payload/roles y aplica límites en I07. Las RPC no son públicas.
Rollback059 se niega si existe cualquier cabecera o contador: no destruye reservas ni
historial. En base vacía restaura practice_free_instructors de021 y retira solo objetos059.
Antes de rollback tras060 revertir dependencias de pagos con plan de operador.

ArnésF45 ejecuta SQL aislado con fixtures y ROLLBACK; no demuestra carreras de dos
conexiones, Auth real, webhook ni producción. La deuda HTTP/concurrencia queda anotada
para la fase final explícitamente autorizada. No se ejecutan otras suites.

Ensayo final F45/001–059:59 aplicaciones,37 preflights,30 verificaciones y40
rollbacks OK; reporte local /tmp/inscripcion-i05-059-final.json. Incluye la consulta
por lote y guardas finales. Typecheck y eslint src OK. Lint global conserva834
errores ajenos en worktrees heredados/tests; no son parte de059.
