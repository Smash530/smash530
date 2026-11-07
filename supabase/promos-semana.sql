-- =====================================================================
-- SMASH · Promos de la semana (vitrina pública)
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
--
-- La página de clientes muestra a todos (con o sin cuenta) las promociones
-- activas de los próximos 7 días, para invitar a registrarse. Usarlas sigue
-- siendo solo para clientes registrados: el descuento se calcula con sesión.
-- Solo lectura; no expone nada que no se vea ya en la página.
-- =====================================================================

create or replace function public.promos_semana()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(p) - 'creado' order by p.creado desc), '[]'::jsonb)
  from public.promociones p
  where p.activa
    and p.hasta >= (now() at time zone 'America/Bogota')::date
    and p.desde <= (now() at time zone 'America/Bogota')::date + 6;
$$;
revoke all on function public.promos_semana() from public;
grant execute on function public.promos_semana() to anon, authenticated;

-- Comprobación: lista (puede ser []) de las promos activas de esta semana
select public.promos_semana();
