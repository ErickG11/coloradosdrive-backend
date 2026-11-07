# F02 · Endurecimiento de permisos (043)

Preparado para aplicación **manual**, después de 042 y coordinado con el backend
del flujo final. No se aplicó a Supabase. Respeta las precisiones autorizadas de F02.

1. Detener escrituras y ejecutar `inscripcion-043-preflight.sql` como `postgres`.
   Lista grants de tablas, columnas, funciones y defaults antes de tocar nada;
   falla si faltan roles, tablas, funciones, bucket privado o las dos políticas.
   Guardar el inventario en un lugar privado de operaciones. No incluye filas.
2. Revisar que el código sigue usando `supabaseAdmin` (service_role) en la capa
   de datos. `supabaseAnon` se declara en config pero no se consume en servicios.
   El frontend llama al backend para datos y usa Broadcast con `private:true`;
   no usa Postgres Changes. Evidencia: `src/config/supabase.ts`, constructores
   de controladores, `src/services/realtime.service.ts` y
   `hooks/useRealtimeChannel.ts` del frontend.
3. Aplicar `migrations/043_inscripcion_endurecimiento.sql`. Guarda un respaldo de
   ACL, defaults, search_path y configuración del bucket, sin datos de negocio,
   en `public.inscripcion_endurecimiento_respaldo`, RLS activo, sin políticas y
   sin permisos para roles API. No editar ese respaldo.
4. Ejecutar `inscripcion-043-verificacion.sql`: compara los ACL de extensiones,
   usa **SET LOCAL ROLE authenticated / anon**, ejecuta SELECT/INSERT/UPDATE/DELETE
   contra cada tabla de public y exige permiso denegado. También verifica
   funciones propias, USAGE privado y defaults de objetos futuros. Todo termina
   con `ROLLBACK`, incluidas sus tablas de prueba y tablas temporales.
5. Prueba manual con tres sesiones distintas: alumno de cohorte A, instructor
   de A y tercero sin relación con A. Con token de cada uno, suscribir un canal
   `cohort-{id-de-A}-practice-slots` con `config.private=true`. Alumno e instructor
   deben recibir `SUBSCRIBED`; tercero debe ser rechazado. Repetir el canal
   personal `user-{id}-practice-slots`: cada uno recibe el suyo, tercero no puede
   recibir el ajeno. Confirmar que la API de datos sigue operativa vía backend.
   Usar cuentas de prueba, no copiar tokens a logs ni capturas.
6. Si falla: no reabrir tráfico; revisar inventario. Para revertir, primero
   revertir migraciones posteriores y ejecutar `inscripcion-043-rollback.sql`.
   Restaura exactamente los grants afectados (incluidas opciones de concesión
   y grants por columna), defaults y bucket desde respaldo. No inventa un
   `GRANT ALL` ni toca ACL de extensiones. Si falta un objeto, falla la transacción.

## Alcance y diferencias

- Todas las funciones **propias** de public/private/coloradosdrive_private pierden
  EXECUTE para PUBLIC/anon/authenticated, con dos excepciones para authenticated:
  `private.can_subscribe_cohort_channel(text)` y
  `private.student_realtime_account_active()`. Se mantiene USAGE en private.
  El backend conserva EXECUTE mediante service_role. Las funciones disparadoras
  también pierden los permisos públicos; los triggers existentes siguen funcionando.
- Funciones de extensiones: exclusión por `pg_depend.classid=pg_proc` y
  `deptype='e'`, independientemente de prefijos o nombres; respaldo y comparación
  del ACL exacto. Se prueba con funciones reales de btree_gist en PostgreSQL embebido.
- REVOKE de tablas incluye grants heredados de PUBLIC y grants explícitos por
  columna, para que los roles no dependan únicamente de RLS para denegar acceso.
- Defaults: FOR ROLE postgres IN SCHEMA public para tablas, funciones y secuencias.
  Además, es necesario retirar el default **global EXECUTE de PUBLIC** para
  funciones: PostgreSQL no permite anularlo con REVOKE por esquema. Esto afecta a
  funciones futuras creadas por postgres, nunca funciones existentes de realtime,
  storage u otros esquemas. Las migraciones nuevas deben dar EXECUTE a service_role
  expresamente. El preflight falla ante otros grants globales explícitos a roles
  API; no cambia unilateralmente defaults de otros esquemas.
- `set_updated_at`: su cuerpo conocido usa solo NEW y la función implícita de
  pg_catalog `now()`, admite search_path vacío. Si difiere del cuerpo revisado,
  no se modifica y se imprime un NOTICE para revisión.
- `enforce_option_question_type`: usa `question_type` y `questions` sin esquema.
  `enforce_attempt_student_role`: usa `user_role` y `users` sin esquema.
  Se revoca EXECUTE público pero **no** se cambia su search_path ni sus cuerpos.
- No se alteran políticas ni objetos de realtime/storage. Única escritura en
  storage: bucket privado `solicitudes-documentos`, límite 2 MiB y MIME de salida
  JPEG/PDF; PNG de entrada será recodificado en F12.
- Scripts repetibles. Rollback sin respaldo tras una reversión previa es un no-op.
  Mantener el respaldo mientras esté abierta la ventana de reversión; no contiene
  nombres, correos, IP, cédulas, tokens ni archivos.

Los ensayos locales no prueban suscripciones reales de Realtime; el paso 5 queda
para la aplicación manual. Referencia de la semántica de defaults:
[PostgreSQL: ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).
