begin read only;
select md5(replace(prosrc,chr(13),''))='ce738a1e05748b13c052286b0261c495' as cuerpo_esperado from pg_proc where oid='public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure;
rollback;
