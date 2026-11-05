-- MANUAL, solo lectura antes de060.
begin;
do $$ declare f text;begin
 foreach f in array array['public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)',
 'private.confirm_student_reservation(uuid,uuid)','private.student_reservation_json(uuid)',
 'public.delete_student_data(uuid,uuid,timestamptz,text[])'] loop
 if to_regprocedure(f) is null then raise exception '060 requiere059 completa; falta %',f;end if;end loop;
 if to_regclass('public.student_schedule_holds') is null or to_regclass('public.student_schedule_events') is null then
 raise exception '060 requiere059 completa';end if;
 if to_regclass('public.payments') is not null then raise exception 'payments ya existe:060 requiere revisión, no se modifica';end if;
end $$;
do $$ begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)')) is distinct from '6e547bb5f1c9196d37bc50b7c169e127' then raise exception '060: cuerpo distinto al revisado: public.manage_student_reservation(uuid,text,uuid,integer,integer,integer)';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.student_reservation_json(uuid)')) is distinct from '07576532175c23401fc166ef9c4741d5' then raise exception '060: cuerpo distinto al revisado: private.student_reservation_json(uuid)';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.delete_student_data(uuid,uuid,timestamptz,text[])')) is distinct from '7f4a4b6eef9d99b30d469ddafdd976ef' then raise exception '060: cuerpo distinto al revisado: public.delete_student_data(uuid,uuid,timestamptz,text[])';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.begin_student_deletion(uuid,uuid,text)')) is distinct from '68908b6fa7be09f7cbc26cb3ec4b128e' then raise exception '060: cuerpo distinto al revisado: public.begin_student_deletion(uuid,uuid,text)';end if;
end $$;
select 'Crear ledger de pagos/eventos/outbox; acotar gracia única y guard de borrado por alumno' as cambio;
rollback;
