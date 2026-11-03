-- F02. Solo lectura. Revisar inventario y evidencia de código en inscripcion-043.md.
begin;
set local statement_timeout='15s';

do $preflight$
declare signature text; t text;
begin
  if current_user <> 'postgres' then raise exception '043 debe ejecutarse como postgres'; end if;
  foreach t in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=t) then raise exception 'Falta rol %',t; end if;
  end loop;
  foreach signature in array array[
    'private.can_subscribe_cohort_channel(text)','private.student_realtime_account_active()',
    'public.enforce_attempt_student_role()','public.enforce_cohort_cupo()',
    'public.enforce_enrollment_student_role()','public.enforce_option_question_type()',
    'public.enforce_practice_slot_instructor_role()','public.enforce_practice_slot_student_role()',
    'public.set_updated_at()','public.consumir_cupo_inscripcion(text,integer)'] loop
    if to_regprocedure(signature) is null then raise exception 'Falta función requerida: %',signature; end if;
    if exists(select 1 from pg_depend where classid='pg_proc'::regclass
      and objid=to_regprocedure(signature) and deptype='e') then
      raise exception 'Objeto requerido inesperadamente pertenece a extensión: %',signature;
    end if;
  end loop;
  foreach t in array array['users','courses','cohorts','enrollments','exams','questions',
    'question_options','exam_attempts','attempt_answers','practice_slots',
    'solicitudes_inscripcion','solicitud_documentos','solicitud_verificaciones'] loop
    if to_regclass('public.'||t) is null then raise exception 'Falta tabla requerida: %',t; end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||t)) then
      raise exception 'RLS debe estar activo: %',t;
    end if;
  end loop;
  if not exists(select 1 from storage.buckets where id='solicitudes-documentos' and not public) then
    raise exception 'Falta bucket privado solicitudes-documentos';
  end if;
  if to_regclass('realtime.messages') is null or
    (select count(*) from pg_policies where schemaname='realtime' and tablename='messages') <> 2 then
    raise exception 'Se esperaban las dos políticas existentes de Broadcast privado';
  end if;
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'Los roles públicos no pueden ser privilegiados';
  end if;
  -- Un REVOKE por esquema no anula grants globales explícitos. No modificar otros esquemas.
  if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and
      ((d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid))
        or (d.defaclobjtype='f' and a.grantee in ('anon'::regrole::oid,'authenticated'::regrole::oid)))) then
    raise exception 'Hay grants globales explícitos para roles públicos; revisar defaults antes de 043';
  end if;
end $preflight$;

-- Permisos efectivos que se retirarán (incluye herencia desde PUBLIC; sin datos de filas).
select n.nspname as esquema,c.relname as objeto,'tabla' as tipo,
  case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as rol,
  a.privilege_type,a.is_grantable
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
where n.nspname='public' and c.relkind in ('r','p','v','m','f')
  and a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid)
order by c.relname,rol,a.privilege_type;
select n.nspname as esquema,p.oid::regprocedure::text as funcion,
  case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as rol,a.privilege_type,
  case when p.oid in ('private.can_subscribe_cohort_channel(text)'::regprocedure,
    'private.student_realtime_account_active()'::regprocedure) and a.grantee='authenticated'::regrole::oid
    then 'CONSERVAR: Broadcast' else 'REVOCAR' end as accion
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
where n.nspname in ('public','private','coloradosdrive_private') and p.prokind in ('f','w')
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  and a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid)
order by esquema,funcion,rol;
select a.attrelid::regclass::text as tabla,a.attname as columna,x.privilege_type,
  case x.grantee when 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as rol
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(a.attacl) x where n.nspname='public' and a.attnum>0 and not a.attisdropped
  and x.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid);
select d.defaclnamespace::regnamespace::text as esquema,d.defaclobjtype,d.defaclacl
from pg_default_acl d where d.defaclrole='postgres'::regrole
  and d.defaclnamespace in (0,'public'::regnamespace::oid);
select p.oid::regprocedure::text as funcion,p.prosrc as cuerpo_a_revisar,p.proconfig
from pg_proc p where p.oid in ('public.set_updated_at()'::regprocedure,
  'public.enforce_option_question_type()'::regprocedure,'public.enforce_attempt_student_role()'::regprocedure);
rollback;
