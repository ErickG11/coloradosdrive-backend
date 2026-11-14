begin read only;
select prosrc like '%waiting_since%' and prosrc like '%case when p_pending then e.status=''pendiente_cohorte''%' as parche_aplicado
from pg_proc where oid='public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)'::regprocedure;
rollback;
