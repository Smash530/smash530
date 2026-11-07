-- =====================================================================
-- SMASH · Horario y días cerrados en línea
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
-- Requiere datos-en-vivo.sql (función panel_rol).
--
-- El dueño guarda desde el panel (Horario) la hora de apertura y cierre,
-- los días de la semana que no abren (ej. martes de descanso) y los días
-- puntuales cerrados (mantenimiento, limpieza). La página de clientes lo
-- lee sin sesión y lo muestra al instante.
-- =====================================================================

create table if not exists public.ajustes_publicos (
  clave text primary key,
  valor jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);
alter table public.ajustes_publicos enable row level security;

-- Cualquiera puede leerlos (son datos públicos de la página); nadie escribe directo
drop policy if exists "leer ajustes publicos" on public.ajustes_publicos;
create policy "leer ajustes publicos" on public.ajustes_publicos for select to anon, authenticated using (true);
grant select on public.ajustes_publicos to anon, authenticated;

-- Solo el dueño (token del panel o cuenta con rol dueño) guarda el horario
create or replace function public.panel_guardar_horario(p_token text, p_horario jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.panel_rol(p_token) is distinct from 'dueno' then
    return jsonb_build_object('ok', false, 'error', 'sin-acceso');
  end if;
  if p_horario is null or jsonb_typeof(p_horario) <> 'object' or length(p_horario::text) > 6000 then
    return jsonb_build_object('ok', false, 'error', 'datos');
  end if;
  insert into public.ajustes_publicos (clave, valor, actualizado) values ('horario', p_horario, now())
  on conflict (clave) do update set valor = excluded.valor, actualizado = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.panel_guardar_horario(text, jsonb) from public;
grant execute on function public.panel_guardar_horario(text, jsonb) to anon, authenticated;

-- Comprobación: debe responder {"ok": false, "error": "sin-acceso"}
select public.panel_guardar_horario('prueba', '{}'::jsonb);
