-- CARGA EXPLÍCITA OPCIONAL, MANUAL y separada de migraciones/F45.
-- Completar las cinco variables y revisar el diff antes de ejecutar en una copia.
-- Los precios se expresan en CENTAVOS, no desde 064 ni desde cohortes.
begin;
do $$
declare
  precio_a_centavos bigint := null; -- PRECIO A pendiente
  precio_b_centavos bigint := null; -- PRECIO B pendiente
  admin_1 uuid := null; -- ADMIN 1 pendiente
  admin_2 uuid := null; -- ADMIN 2 pendiente
  actor uuid := null; -- administrador que autoriza esta carga
  razon text := 'Carga inicial revisada del lote 1';
  a uuid; permiso text; antiguo jsonb;
begin
 if precio_a_centavos is null or precio_b_centavos is null or admin_1 is null or admin_2 is null or actor is null then
   raise exception 'Completar precios A/B, ADMIN 1, ADMIN 2 y actor; ningún dato fue cargado';end if;
 if admin_1=admin_2 then raise exception 'Los dos administradores deben ser distintos';end if;
 if exists(select 1 from unnest(array[admin_1,admin_2,actor]) id
   where not exists(select 1 from public.users u where u.id=id and u.rol='admin' and u.activo)) then
   raise exception 'Identidades administrativas no válidas o inactivas';end if;
 if exists(select 1 from public.course_type_prices) then raise exception 'Precios ya configurados: usar cambio auditado, no recargar';end if;
 insert into public.course_type_prices(tipo,precio_centavos,updated_by,motivo)
 values('A',precio_a_centavos,actor,razon),('B',precio_b_centavos,actor,razon);
 insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason)
 select actor,'initial_price','course_type',tipo::text,jsonb_build_object('centavos',precio_centavos,'moneda',moneda),razon
 from public.course_type_prices;
 foreach a in array array[admin_1,admin_2] loop
   foreach permiso in array array['verify_identity','manage_cohorts_prices','reassign_schedules','view_payments_invoices'] loop
     select to_jsonb(p) into antiguo from public.enrollment_admin_permissions p where admin_id=a and permission=permiso;
     if antiguo is not null then raise exception 'Permiso inicial ya existente: revisar sin sobrescribir';end if;
     insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values(a,permiso,actor,razon);
     insert into public.enrollment_domain_audit(actor_id,action,entity_type,entity_id,new_value,reason)
     values(actor,'grant_permission','admin',a::text,jsonb_build_object('permission',permiso),razon);
   end loop;
 end loop;
end $$;
commit;
