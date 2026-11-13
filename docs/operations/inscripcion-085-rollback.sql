begin;
set local lock_timeout='5s';
create or replace function pg_temp.patch_fn(p_sig regprocedure,p_old text,p_new text) returns void language plpgsql as $f$declare d text;begin
 d:=pg_get_functiondef(p_sig);
 if position(p_old in d)=0 then raise exception 'ROLLBACK_085_NO_APLICABLE: % no contiene el fragmento esperado',p_sig;end if;
 execute replace(d,p_old,p_new);end $f$;
do $$declare s regprocedure:='public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure;begin
 perform pg_temp.patch_fn(s,
  $a$(p_pending is null or case when p_pending then e.status='pendiente_cohorte' else (e.etapa_inscripcion='activa' and e.status<>'pendiente_cohorte') end)$a$,
  $a$(p_pending is null or (e.etapa_inscripcion='activa' and (e.status='pendiente_cohorte')=p_pending))$a$);
 perform pg_temp.patch_fn(s,
  $a$      m.enrollments,
      (select min(x.fecha_inscripcion) from public.enrollments x where x.student_id=u.id and x.status='pendiente_cohorte' and x.cohort_id is null) as waiting_since
    from public.users u$a$,
  $a$      m.enrollments
    from public.users u$a$);
 perform pg_temp.patch_fn(s,
  $a$select * from matched order by (waiting_since is null),waiting_since,nombre_completo,id$a$,
  $a$select * from matched order by nombre_completo,id$a$);
 perform pg_temp.patch_fn(s,
  $a$      order by (waiting_since is null),waiting_since,nombre_completo,id) from page_rows$a$,
  $a$      order by nombre_completo,id) from page_rows$a$);
 if md5(replace((select prosrc from pg_proc where oid=s),chr(13),''))<>'ce738a1e05748b13c052286b0261c495' then raise exception 'ROLLBACK_085: el cuerpo restaurado no coincide con el original';end if;
end $$;
commit;
