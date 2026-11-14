begin read only;
do $guard$ declare g record;h text;begin
 for g in select * from(values
  ('private.legacy079_enrollment_has_access_v2(uuid)','6a1e108ca18e9afb6a50f1c20438f200','3739c28486fc809ee4ad81dfe16c27d4',false),
  ('private.enrollment_has_access_v2(uuid)','bd6b761932fa1e3deb81deb78face079','bd6b761932fa1e3deb81deb78face079',false),
  ('cancel_cohort_v2(uuid,uuid,timestamp with time zone,text)','5dcdeef6b0ea59d747a27e5172d93546','4180a0cfc343941461145181241fcec4',false),
  ('assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamp with time zone,date)','0baaa22e811c1389126db911a73c9051','0baaa22e811c1389126db911a73c9051',false),
  ('admin_enrollment_management_v12(uuid,uuid,uuid)','99849849543c5280cfb0040cf65060b0','b73535818cbd26be3dfd416f0f704989',false),
  ('public.assign_pending_enrollment_cohort_with_reason_v13(uuid,uuid,uuid,uuid,timestamp with time zone,date,text)','6689f2145928f10c3e49dded961b9c57','6689f2145928f10c3e49dded961b9c57',true)
 ) v(sig,before_hash,after_hash,may_be_absent) loop
 select md5(replace(prosrc,chr(13),'')) into h from pg_proc where oid=to_regprocedure(g.sig);
 if not(g.may_be_absent and h is null) and (h is null or h not in(g.before_hash,g.after_hash)) then raise exception 'PREFLIGHT_087: % tiene un cuerpo desconocido (%)',g.sig,coalesce(h,'AUSENTE');end if;
 end loop;
end $guard$;
select p.oid::regprocedure,md5(replace(prosrc,chr(13),'')) as body_hash from pg_proc p where p.oid in('private.legacy079_enrollment_has_access_v2(uuid)'::regprocedure,'private.enrollment_has_access_v2(uuid)'::regprocedure);
rollback;
