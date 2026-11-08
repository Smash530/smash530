-- =====================================================================
-- SMASH · 15 puntos de regalo al registrarse en el Club SMASH
-- Pégalo completo en Supabase → SQL Editor → New query → Run (una vez).
-- No borra nada. Se puede volver a ejecutar sin problema.
-- Requiere haber ejecutado antes: esquema.sql
--
-- Qué hace:
--   Cuando una cuenta nueva confirma su correo, la base de datos le suma
--   15 puntos sola (motivo "Regalo de bienvenida"). No depende de la
--   página ni de la caja: pasa dentro de Supabase en el momento de la
--   confirmación. Si en Supabase está apagada la confirmación por correo,
--   los puntos llegan apenas se crea la cuenta.
--   Cada cuenta recibe el regalo UNA sola vez (aunque confirme dos veces).
--   Solo cuentas de cliente; caja y dueños no lo reciben.
-- =====================================================================

create or replace function public.dar_bienvenida(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  bono constant integer := 15;     -- ← cambia aquí los puntos de regalo
begin
  if not exists (select 1 from public.perfiles where id = p_id and rol = 'cliente') then return; end if;
  if exists (select 1 from public.puntos_mov where cliente = p_id and pedido = 'bienvenida') then return; end if;
  insert into public.puntos_mov (cliente, puntos, motivo, pedido, por)
    values (p_id, bono, '🎁 Regalo de bienvenida al Club SMASH', 'bienvenida', null);
  update public.perfiles set puntos = puntos + bono where id = p_id;
exception when unique_violation then
  null;   -- ya lo tenía: no se repite
end $$;
revoke execute on function public.dar_bienvenida(uuid) from public, anon, authenticated;

create or replace function public.bienvenida_al_confirmar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;
  begin
    perform public.dar_bienvenida(new.id);
  exception when others then
    null;   -- un problema con el regalo nunca debe impedir registrarse o confirmar
  end;
  return new;
end $$;

-- "zz_" para que corra DESPUÉS de "al_registrarse" (que crea el perfil)
drop trigger if exists zz_bienvenida_alta on auth.users;
create trigger zz_bienvenida_alta after insert on auth.users
  for each row execute function public.bienvenida_al_confirmar();
drop trigger if exists zz_bienvenida_confirma on auth.users;
create trigger zz_bienvenida_confirma after update of email_confirmed_at on auth.users
  for each row execute function public.bienvenida_al_confirmar();

-- ---------------------------------------------------------------------
-- OPCIONAL · Regalar también a los clientes que YA estaban registrados
-- (con correo confirmado). Quita los dos guiones "--" de la línea de
-- abajo y vuelve a ejecutar. Nadie lo recibe dos veces.
-- ---------------------------------------------------------------------
-- select public.dar_bienvenida(u.id) from auth.users u where u.email_confirmed_at is not null;

-- Comprobación: últimos regalos entregados
select p.nombre, p.correo, p.puntos, m.creado
from public.puntos_mov m join public.perfiles p on p.id = m.cliente
where m.pedido = 'bienvenida' order by m.creado desc limit 10;
