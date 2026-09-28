-- 011_realtime_broadcast_authorization.sql
--
-- ==========================================================================
-- YA APLICADA en Supabase — no volver a ejecutar. Este archivo existe solo
-- para que el repositorio refleje el estado real de la base de datos.
-- ==========================================================================
--
-- Contexto: sin esto, cualquiera con la anon key que conociera o adivinara
-- el nombre de un canal de Broadcast (cohort-{cohortId}-practice-slots,
-- user-{userId}-practice-slots) podía suscribirse sin ninguna verificación
-- — Supabase Realtime no exige RLS para canales "públicos" (el default).
-- Marcar el canal como privado (`channel(topic, { config: { private: true
-- } })`, ya hecho en el frontend y en RealtimeService.broadcast del
-- backend) hace que la suscripción SÍ pase por RLS sobre `realtime.messages`
-- — sin ninguna política ahí, el default es denegar todo.
--
-- El backend siempre envía (`broadcast()`) con supabaseAdmin (service_role),
-- que ignora RLS por diseño — así que estas políticas solo hacen falta para
-- SELECT (recibir/suscribirse), nunca para INSERT (enviar).

-- ---------------------------------------------------------------------
-- Función auxiliar en un esquema privado
-- ---------------------------------------------------------------------
-- Por qué SECURITY DEFINER es imprescindible aquí (no un simple gusto de
-- estilo): la política de cohorte necesita consultar public.users,
-- public.enrollments y public.practice_slots para decidir si el usuario
-- puede suscribirse. Pero esas tablas tienen RLS activo sin políticas para
-- `authenticated` desde 009_enable_rls.sql — una política evaluada
-- directamente "como authenticated" que intente un `exists (select ...
-- from public.enrollments ...)` chocaría con esa misma RLS y siempre
-- devolvería 0 filas, negando la suscripción a todo el mundo sin importar
-- los datos reales (bug real de la primera versión de esta migración,
-- nunca llegó a producción). SECURITY DEFINER hace que la función corra
-- con los privilegios de quien la creó (que sí puede leer esas tablas),
-- sorteando ese problema sin tener que abrir RLS de tabla para
-- `authenticated`.
--
-- search_path vacío (set search_path = '') es el hardening estándar de
-- Postgres para funciones SECURITY DEFINER: sin esto, alguien con permiso
-- de crear objetos en algún esquema del search_path podría "secuestrar" una
-- referencia sin calificar (ej. crear su propia tabla `users` en un
-- esquema anterior en el path) y hacer que la función la lea a ella en vez
-- de la real. Por eso todas las referencias de tabla adentro van
-- completamente calificadas (public.users, no solo users).
--
-- Comparación como texto (no ::uuid): un ::uuid inválido lanza una
-- excepción en vez de simplemente no matchear - un topic malformado
-- rompería la política entera en lugar de solo negar el acceso. Comparar
-- como texto con lower() en ambos lados nunca lanza, solo no coincide.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.can_subscribe_cohort_channel(p_topic text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid text := (select auth.uid())::text;
  -- Ancla ambos extremos y exige exactamente 36 caracteres (largo de un
  -- UUID con guiones): un topic que no calce ese formato exacto no
  -- extrae nada y la función devuelve false más abajo.
  v_cohort_id text := lower(substring(p_topic from '^cohort-([0-9a-fA-F-]{36})-practice-slots$'));
begin
  if v_uid is null or v_cohort_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.users u
    where u.id::text = v_uid
      and u.rol = 'admin'
  )
  or exists (
    select 1
    from public.enrollments e
    where e.student_id::text = v_uid
      and e.status = 'activo'
      and lower(e.cohort_id::text) = v_cohort_id
  )
  or exists (
    select 1
    from public.practice_slots ps
    where ps.instructor_id::text = v_uid
      and lower(ps.cohort_id::text) = v_cohort_id
  );
end;
$$;

revoke all on function private.can_subscribe_cohort_channel(text) from public, anon;
grant execute on function private.can_subscribe_cohort_channel(text) to authenticated;

-- ---------------------------------------------------------------------
-- Canal personal: user-{auth.uid()}-practice-slots
-- ---------------------------------------------------------------------
-- Comparación exacta contra auth.uid() (nunca contra un UUID tomado del
-- topic sin verificar): el propio usuario autenticado es el único que
-- puede suscribirse a SU canal. (select auth.uid()) envuelto en subquery
-- para que Postgres lo evalúe una sola vez por consulta (InitPlan), no
-- una vez por fila - recomendación de rendimiento de Supabase para RLS.
create policy "user-practice-slots: solo el propio usuario"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() = 'user-' || (select auth.uid())::text || '-practice-slots'
);

-- ---------------------------------------------------------------------
-- Canal de cohorte: cohort-{cohortId}-practice-slots
-- ---------------------------------------------------------------------
-- Nombre truncado a propósito a 63 caracteres (límite de identificador de
-- Postgres) - este es el nombre exacto ya aplicado.
create policy "cohort-practice-slots: admin, instructor de la cohorte o estudi"
on realtime.messages
for select
to authenticated
using (
  private.can_subscribe_cohort_channel(realtime.topic())
);

-- ---------------------------------------------------------------------
-- Cómo probar (no se puede ejecutar desde este entorno contra el
-- proyecto real — dos formas de verificarlo manualmente):
-- ---------------------------------------------------------------------
-- A) Con el Realtime Inspector del dashboard de Supabase (Database >
--    Realtime > Inspector): iniciar sesión como un estudiante SIN
--    inscripción activa en una cohorte X, intentar suscribirse al canal
--    `cohort-{X}-practice-slots` con "Private channel" activado — debe
--    fallar la suscripción (no debe poder unirse al canal).
-- B) Con un script Node de un solo uso usando @supabase/supabase-js y la
--    anon key, autenticando dos usuarios distintos (uno matriculado en la
--    cohorte, otro no) y llamando en cada caso:
--      const channel = supabase.channel(`cohort-${cohortId}-practice-slots`,
--        { config: { private: true } });
--      channel.subscribe((status) => console.log(status));
--    El usuario sin inscripción debe recibir CHANNEL_ERROR (o quedarse sin
--    pasar a SUBSCRIBED); el matriculado debe llegar a SUBSCRIBED.
