-- =====================================================================
-- SMASH · Promociones por día de la semana
-- Pégalo completo en Supabase → SQL Editor → New query → Run (una vez).
-- No borra nada: solo añade la columna "dias" y ajusta quién ve qué.
-- =====================================================================

-- Días en que aplica cada promoción: 0 = domingo, 1 = lunes … 6 = sábado.
-- Vacío = todos los días (así quedan las promociones que ya existen).
alter table public.promociones
  add column if not exists dias smallint[] not null default '{}';

alter table public.promociones drop constraint if exists promociones_dias_validos;
alter table public.promociones add constraint promociones_dias_validos
  check (dias <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);

-- Los clientes solo ven las promociones de HOY (fecha y día de Colombia).
drop policy if exists "ver promociones" on public.promociones;
create policy "ver promociones" on public.promociones for select to authenticated
  using (
    (activa
      and (now() at time zone 'America/Bogota')::date between desde and hasta
      and (cardinality(dias) = 0
           or extract(dow from (now() at time zone 'America/Bogota'))::smallint = any (dias)))
    or public.mi_rol() in ('caja', 'dueno')
  );
