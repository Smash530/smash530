-- =====================================================================
-- SMASH · Entrar sin confirmar el correo
-- Pégalo completo en Supabase → SQL Editor → New query → Run (una vez).
-- No borra nada. Se puede volver a ejecutar sin problema.
--
-- ANTES (o después) haz esto en Supabase, es lo que quita el correo:
--   Authentication → Sign In / Providers → Email → apaga "Confirm email" → Save
--   Desde ahí, quien crea su cuenta entra de una, sin esperar ningún correo.
--
-- Qué hace este SQL:
--   Activa las cuentas que ya se habían creado pero quedaron esperando el
--   correo de confirmación (por eso esos clientes no podían entrar).
--   Al activarlas, la base de datos les entrega solos sus 15 puntos de
--   bienvenida (si ya los tenían, no se repiten).
-- =====================================================================

update auth.users
   set email_confirmed_at = now()
 where email_confirmed_at is null;

-- Comprobación: debe salir 0 (ninguna cuenta esperando confirmación)
select count(*) as cuentas_sin_activar from auth.users where email_confirmed_at is null;
