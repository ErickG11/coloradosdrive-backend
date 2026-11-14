-- Carga explícita D7/D8. Revisar y aplicar MANUALMENTE tras 081. Nunca 064.
begin;
do $$declare actor uuid;r record;before jsonb;begin
 select id into actor from public.users where rol='admin' and activo order by created_at,id limit 1;
 if actor is null then raise exception 'Se requiere un administrador activo para registrar la carga de precios';end if;
 for r in select * from(values('A'::public.course_type,15000::bigint),('B'::public.course_type,20000::bigint)) x(tipo,centavos) loop
 select to_jsonb(p) into before from public.course_type_prices p where tipo=r.tipo;
 insert into public.course_type_prices(tipo,precio_centavos,updated_by,motivo) values(r.tipo,r.centavos,actor,'D7: precio explícito aprobado por el dueño') on conflict(tipo) do update set precio_centavos=excluded.precio_centavos,updated_by=excluded.updated_by,motivo=excluded.motivo,updated_at=clock_timestamp();
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,old_value,new_value,reason) values(actor,'price_data_D7','course_type',r.tipo::text,before,jsonb_build_object('centavos',r.centavos),'D7: carga explícita A=150 USD, B=200 USD');
 end loop;
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason)
 select a.value::uuid,p,actor,'D8: snapshot de administradores existentes al aplicar 081' from public.enrollment_domain_audit e cross join lateral jsonb_array_elements_text(e.new_value->'admins') a cross join unnest(array['verify_identity','manage_cohorts_prices','reassign_schedules','view_payments_invoices']) p
 where e.action='admin_snapshot_081' and e.entity_id='081' on conflict(admin_id,permission) do nothing;
end $$;
commit;
