# Pruebas reales de PostgreSQL para CD-05–07

**Preparadas, no ejecutadas en el entorno de implementación.** Se necesita PostgreSQL
local ya disponible, cliente `psql` y una base exclusiva vacía sin datos reales.
El runner no instala infraestructura, no crea bases/roles, no carga .env y no contacta
Supabase. Usa únicamente los nombres CD_TEST_DATABASE_URL, CD_TEST_DATABASE_DISPOSABLE
y, opcionalmente, CD_TEST_PSQL (ruta de un psql existente). No registrar sus valores.

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
005/010/018/019. Valida la duración por defecto y explícita, solapamientos parciales
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

El runner valida reversión/reaplicación y deja el fixture en esa base para inspección.
No elimina la base ni extensiones. Para repetir, preparar otra base vacía autorizada.
No sustituye la prueba de migraciones 001–019 completas ni la compatibilidad real de
Supabase/PostgREST y RLS; validar esas capas también en un entorno desechable antes de aplicar.
