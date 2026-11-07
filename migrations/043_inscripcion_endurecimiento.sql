-- F02 / Migración B. Aplicación MANUAL después de 042. Excepciones autorizadas de Broadcast.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

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

-- Respaldo exclusivo de METADATOS: nunca filas de negocio ni credenciales.
create table if not exists public.inscripcion_endurecimiento_respaldo (
  id boolean primary key check(id),
  restauracion text[] not null,
  extensiones jsonb not null,
  creado_at timestamptz not null default now()
);
alter table public.inscripcion_endurecimiento_respaldo enable row level security;
revoke all on public.inscripcion_endurecimiento_respaldo from public,anon,authenticated,service_role;

do $respaldo$
declare o record; a record; scope text; kind text; typ "char"; acl aclitem[];
  restore text[] := array[]::text[]; target text; signature text; extension_acl jsonb; old_path text;
begin
  if exists(select 1 from public.inscripcion_endurecimiento_respaldo where id) then return; end if;
  for o in select c.*,format('%I.%I',n.nspname,c.relname) as qualified
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
      and c.relname<>'inscripcion_endurecimiento_respaldo' order by c.oid loop
    restore := array_append(restore,format('revoke all on table %s from public,anon,authenticated',o.qualified));
    for a in select * from aclexplode(coalesce(o.relacl,acldefault('r',o.relowner)))
      where grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid) loop
      target := case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
      restore := array_append(restore,format('grant %s on table %s to %s%s',a.privilege_type,o.qualified,target,
        case when a.is_grantable then ' with grant option' else '' end));
    end loop;
    for a in select attname,attacl from pg_attribute where attrelid=o.oid and attnum>0 and not attisdropped and attacl is not null loop
      restore := array_append(restore,format('revoke select(%1$I),insert(%1$I),update(%1$I),references(%1$I) on %2$s from public,anon,authenticated',a.attname,o.qualified));
      for signature in select format('grant %s(%I) on %s to %s%s',x.privilege_type,a.attname,o.qualified,
        case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end,
        case when x.is_grantable then ' with grant option' else '' end)
        from aclexplode(a.attacl) x where x.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid) loop
        restore := array_append(restore,signature);
      end loop;
    end loop;
  end loop;
  for o in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','coloradosdrive_private') and p.prokind in ('f','w')
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') loop
    signature := format('%I.%I(%s)',(select nspname from pg_namespace where oid=o.pronamespace),o.proname,pg_get_function_identity_arguments(o.oid));
    restore := array_append(restore,format('revoke all on function %s from public,anon,authenticated,service_role',signature));
    for a in select * from aclexplode(coalesce(o.proacl,acldefault('f',o.proowner)))
      where grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid) loop
      target := case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
      restore := array_append(restore,format('grant execute on function %s to %s%s',signature,target,
        case when a.is_grantable then ' with grant option' else '' end));
    end loop;
  end loop;
  -- Guardar USAGE/CREATE de los tres roles afectados en private.
  restore := array_append(restore,'revoke all on schema private from public,anon,authenticated');
  for a in select * from aclexplode(coalesce((select nspacl from pg_namespace where nspname='private'),acldefault('n',(select nspowner from pg_namespace where nspname='private'))))
    where grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid) loop
    restore := array_append(restore,format('grant %s on schema private to %s%s',a.privilege_type,
      case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
      case when a.is_grantable then ' with grant option' else '' end));
  end loop;
  -- Defaults de postgres en public + único default global alterado: EXECUTE para PUBLIC.
  for typ,kind,scope in select * from (values
    ('r'::"char",'tables',' in schema public'),('f'::"char",'functions',' in schema public'),
    ('S'::"char",'sequences',' in schema public'),('f'::"char",'functions','')) v(t,k,s) loop
    target := case when scope='' then 'PUBLIC' else 'PUBLIC,anon,authenticated' end;
    restore := array_append(restore,format('alter default privileges for role postgres%s revoke all on %s from %s',scope,kind,target));
    select defaclacl into acl from pg_default_acl where defaclrole='postgres'::regrole
      and defaclobjtype=typ and defaclnamespace=case when scope='' then 0 else 'public'::regnamespace::oid end;
    if acl is null and scope='' then acl:=acldefault(typ,'postgres'::regrole); end if;
    for a in select * from aclexplode(acl)
      where grantee=0 or (scope<>'' and grantee in ('anon'::regrole::oid,'authenticated'::regrole::oid)) loop
      restore := array_append(restore,format('alter default privileges for role postgres%s grant %s on %s to %s%s',scope,a.privilege_type,kind,
        case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
        case when a.is_grantable then ' with grant option' else '' end));
    end loop;
  end loop;
  select substring(c from length('search_path=')+1) into old_path
    from pg_proc p cross join lateral unnest(p.proconfig) c where p.oid='public.set_updated_at()'::regprocedure and c like 'search_path=%';
  restore:=array_append(restore,case when old_path is null then 'alter function public.set_updated_at() reset search_path'
    else format('alter function public.set_updated_at() set search_path=%L',old_path) end);
  select array_append(restore,format('update storage.buckets set file_size_limit=%L,allowed_mime_types=%L::text[] where id=%L',
    file_size_limit,allowed_mime_types,'solicitudes-documentos')) into restore from storage.buckets where id='solicitudes-documentos';
  select coalesce(jsonb_object_agg(p.oid::text,to_jsonb(p.proacl)),'{}'::jsonb) into extension_acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','coloradosdrive_private')
      and exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');
  insert into public.inscripcion_endurecimiento_respaldo(id,restauracion,extensiones) values(true,restore,extension_acl);
end $respaldo$;

revoke all on all tables in schema public from public,anon,authenticated;
-- Los grants por columna no desaparecen con REVOKE sobre la tabla.
do $columnas$ declare c record; begin
  for c in select format('%I.%I',n.nspname,t.relname) as tabla,a.attname
    from pg_attribute a join pg_class t on t.oid=a.attrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null loop
    execute format('revoke select(%1$I),insert(%1$I),update(%1$I),references(%1$I) on %2$s from public,anon,authenticated',c.attname,c.tabla);
  end loop;
end $columnas$;

do $funciones$ declare f record; signature text; begin
  for f in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','coloradosdrive_private') and p.prokind in ('f','w')
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') loop
    signature:=format('%I.%I(%s)',f.nspname,f.proname,pg_get_function_identity_arguments(f.oid));
    execute format('revoke all on function %s from public,anon,authenticated',signature);
    execute format('grant execute on function %s to service_role',signature);
  end loop;
end $funciones$;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.can_subscribe_cohort_channel(text),private.student_realtime_account_active() to authenticated;

-- PostgreSQL no permite que un REVOKE por esquema anule el default global PUBLIC.
-- Retirar solo ese default global, sin cambiar funciones existentes en otros esquemas.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public,anon,authenticated;

-- Cuerpo conocido: solo NEW y now() de pg_catalog. No asumir seguridad de otros cuerpos.
do $search_path$ begin
  if regexp_replace((select prosrc from pg_proc where oid='public.set_updated_at()'::regprocedure),'\s','','g')
    in ('beginnew.updated_at=now();returnnew;end;','beginnew.updated_at:=now();returnnew;end;') then
    alter function public.set_updated_at() set search_path='';
  else raise notice 'set_updated_at no coincide con el cuerpo revisado: search_path sin modificar'; end if;
  raise notice 'enforce_option_question_type y enforce_attempt_student_role usan tipos/tablas sin esquema en el repositorio: search_path sin modificar';
end $search_path$;
update storage.buckets set file_size_limit=2097152,allowed_mime_types=array['image/jpeg','application/pdf']
  where id='solicitudes-documentos';
notify pgrst,'reload schema';
commit;
