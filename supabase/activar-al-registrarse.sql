-- =====================================================================
-- SMASH · Toda cuenta nueva queda ACTIVADA al registrarse
-- Pégalo completo en Supabase → SQL Editor → New query → Run (una vez).
-- No borra nada. Se puede volver a ejecutar sin problema.
--
-- 1) Cada cuenta nueva se marca como confirmada en el mismo momento en que
--    se crea (aunque "Confirm email" siga prendido en Supabase).
-- 2) Activa las cuentas que quedaron pendientes esperando el correo.
--    Al activarlas reciben solas sus 15 puntos de bienvenida (sin repetir).
-- =====================================================================

create or replace function public.activar_al_registrarse() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.email_confirmed_at is null then new.email_confirmed_at := now(); end if;
  return new;
end $$;

drop trigger if exists aa_activar_al_registrarse on auth.users;
create trigger aa_activar_al_registrarse before insert on auth.users
  for each row execute function public.activar_al_registrarse();

-- Activar las pendientes
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

-- Comprobación: debe salir 0
select count(*) as cuentas_sin_activar from auth.users where email_confirmed_at is null;
