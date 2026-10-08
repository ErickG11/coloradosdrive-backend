# Pruebas reales de PostgreSQL para CD-05–07

**Ejecutadas en PostgreSQL 17.6.** Se necesita PostgreSQL
local ya disponible, cliente `psql` y una base exclusiva vacía sin datos reales.
El runner no instala infraestructura, no crea bases/roles, no carga .env y no contacta
Supabase. Usa únicamente los nombres CD_TEST_DATABASE_URL, CD_TEST_DATABASE_DISPOSABLE
y, opcionalmente, CD_TEST_PSQL (ruta de un psql existente). No registrar sus valores.
CD_TEST_BTREE_GIST selecciona `absent` (default), `public` o `extensions` y exige que
la extensión tenga ese estado inicial antes de escribir. Cada escenario usa otra base nueva.

## Runner sin Docker

El propietario local debe preparar una base llamada `cd_practice_test_<sufijo>` con
comentario **ColoradosDrive disposable CD-05-07 test** y roles existentes service_role,
anon, authenticated. Necesita permisos para crear tablas, funciones y btree_gist.
Debe ser una base desechable nueva; el runner rechaza hosts externos, parámetros extra
de conexión, bases sin marca y bases con tablas/vistas de usuario, aun fuera de public.
No apuntar a un túnel de una base compartida. CD_TEST_DATABASE_DISPOSABLE debe valer YES.

Tras preparar esas variables solo para el proceso local autorizado:

```powershell
node tests/database/run.mjs
```

Usa un fixture mínimo de users/cohorts/enrollments y aplica las migraciones reales
005/010/018/019 y, tras las pruebas de rollback, la 021. Valida la duración por defecto y explícita, solapamientos parciales
por ambas puntas y completos, intervalos contiguos, instructor distinto, liberado,
completado, sin_practica, cambios de instructor/inicio/duración y disponibilidad.
Comprueba fallos identificables de precondiciones conservando los registros, permisos
RPC, límite exacto de la función que se usa al escribir y cierre/finalización del cron.

Las carreras usan **dos sesiones/transacciones reales** y una tercera observa que la
segunda espera un lock: creación solapada con un ganador, reclamación con un ganador y
confirmación/reclamación que esperan un lock y cruzan closeAt. Las tres fases del scheduler se prueban
con versiones obsoletas entre transacciones separadas. Las pruebas Jest comprueban que
cero filas implica cero correos/eventos. El límite exacto se prueba con tiempo fijo en
el predicado SQL compartido; las RPC usan exclusivamente clock_timestamp(), sin inyectar
relojes de prueba ni admitir tiempos suministrados por el cliente.

La ampliación ejecuta 27 carreras con sesiones independientes y comprueba ambos
resultados y el estado final: scheduler contra scheduler (las tres fases y todos los
estados cerrables), confirmación/cancelación/reclamación, cambio de propietario,
edición administrativa de inicio/instructor/cohorte y cambios de matrícula mientras
claim espera. El orden inverso prueba el FOR SHARE de la matrícula. La sincronización
exige `pg_blocking_pids` y un lock no concedido observado en `pg_locks`; los plazos se
cruzan observando el predicado con el reloj real de PostgreSQL, no solo durmiendo.

Las seis funciones se llaman con roles efectivos anon, authenticated y service_role.
Anon/authenticated fallan por EXECUTE incluso con acceso a tablas. Service_role puede
ejecutar las puras sin tablas; las otras requieren permisos de tablas por SECURITY
INVOKER. Estos GRANT son del fixture local y no modelan RLS ni Auth de Supabase.

El runner ejecuta reversión/reaplicación para **018+019 aplicadas** y **solo 018 aplicada**
después de inducir un error CD019 al final del DDL/ACL de 019, antes del commit.
Comprueba que no queden funciones, triggers o ACL parciales. Usa el mismo script operativo:
revierte 018+019, reaplica solo 018, revierte ese estado y reaplica 018→019. Compara el
contenido completo de las filas antes/después, la permanencia de btree_gist, el índice
anterior y la retirada de las restricciones. Ambos escenarios aprobaron en las tres
variantes de extensión; también se compara su OID, esquema y versión para detectar movimientos.
Deja el fixture en esa base para inspección. No elimina la base ni extensiones.
Para repetir, preparar otra base vacía autorizada.
No sustituye la prueba de migraciones 001–019 completas ni la compatibilidad real de
Supabase/PostgREST y RLS; validar esas capas también en un entorno desechable antes de aplicar.
