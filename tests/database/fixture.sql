-- Fixture mínimo SOLO para una base vacía, local y marcada como desechable.
-- El runner verifica esas precondiciones antes de ejecutar este archivo.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'El entorno desechable necesita los roles de Supabase; el test no crea roles compartidos';
  end if;
end; $$;
create type public.user_role as enum ('admin', 'instructor', 'estudiante');
create table public.users(id uuid primary key, rol public.user_role not null, nombre_completo text not null);
create table public.cohorts(id uuid primary key);
create table public.enrollments(id uuid primary key, student_id uuid references public.users,
  cohort_id uuid references public.cohorts, status text not null);
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
insert into public.users values
 ('10000000-0000-4000-8000-000000000001', 'instructor', 'Instructor de prueba 1'),
 ('10000000-0000-4000-8000-000000000002', 'instructor', 'Instructor de prueba 2'),
 ('20000000-0000-4000-8000-000000000001', 'estudiante', 'Estudiante de prueba 1'),
 ('20000000-0000-4000-8000-000000000002', 'estudiante', 'Estudiante de prueba 2'),
 ('20000000-0000-4000-8000-000000000003', 'estudiante', 'Estudiante de otra cohorte');
insert into public.cohorts values ('30000000-0000-4000-8000-000000000001'), ('30000000-0000-4000-8000-000000000002');
insert into public.enrollments values
 ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'activo'),
 ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'activo'),
 ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'activo');
