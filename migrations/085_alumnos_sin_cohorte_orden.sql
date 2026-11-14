-- C06: "Sin cohorte" incluye toda matrícula pendiente_cohorte (manual, por agendar o reservada)
-- y los alumnos que esperan cohorte salen primero (los que llevan más tiempo, arriba).
-- Solo cambia el filtro p_pending=true y el orden; firma, parámetros y el resto no se tocan.
begin;
set local lock_timeout='5s';
-- GUARDA-MD5 INICIO (hash congelado de la instalación local; md5(replace(prosrc,chr(13),'')))
do $guard$declare g record;begin
 for g in select * from (values
  ('public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)','ce738a1e05748b13c052286b0261c495')
 ) v(sig,h) loop
  if to_regprocedure(g.sig) is null or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(g.sig)) is distinct from g.h then
   raise exception 'GUARDA_085: % no coincide con el cuerpo esperado; no se aplica la migración',g.sig;
  end if;
 end loop;
end $guard$;
-- GUARDA-MD5 FIN
create or replace function pg_temp.patch_fn(p_sig regprocedure,p_old text,p_new text) returns void language plpgsql as $f$declare d text;begin
 d:=pg_get_functiondef(p_sig);
 if position(p_old in d)=0 then raise exception 'PARCHE_085_NO_APLICABLE: % no contiene el fragmento esperado',p_sig;end if;
 execute replace(d,p_old,p_new);end $f$;
do $$declare s regprocedure:='public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure;begin
 -- (a) "Sin cohorte": sin restricción de etapa. El valor false conserva su significado anterior.
 perform pg_temp.patch_fn(s,
  $a$(p_pending is null or (e.etapa_inscripcion='activa' and (e.status='pendiente_cohorte')=p_pending))$a$,
  $a$(p_pending is null or case when p_pending then e.status='pendiente_cohorte' else (e.etapa_inscripcion='activa' and e.status<>'pendiente_cohorte') end)$a$);
 -- (b) Antigüedad de la espera por alumno, independiente de los filtros de la lista.
 perform pg_temp.patch_fn(s,
  $a$      m.enrollments
    from public.users u$a$,
  $a$      m.enrollments,
      (select min(x.fecha_inscripcion) from public.enrollments x where x.student_id=u.id and x.status='pendiente_cohorte' and x.cohort_id is null) as waiting_since
    from public.users u$a$);
 perform pg_temp.patch_fn(s,
  $a$select * from matched order by nombre_completo,id$a$,
  $a$select * from matched order by (waiting_since is null),waiting_since,nombre_completo,id$a$);
 perform pg_temp.patch_fn(s,
  $a$      order by nombre_completo,id) from page_rows$a$,
  $a$      order by (waiting_since is null),waiting_since,nombre_completo,id) from page_rows$a$);
end $$;
commit;
