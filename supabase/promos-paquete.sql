-- =====================================================================
-- SMASH · Promociones tipo "paquete" (ej. Viernes Campeón)
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
-- Requiere haber ejecutado antes promos-por-producto.sql.
--
-- Un paquete junta varias burgers (una de cada una, con combo si se marca)
-- a un precio fijo. Se muestra como una burger más, solo el día de la promo
-- y solo a clientes registrados. Usa las columnas que ya existen:
--   producto = burgers del paquete · regalo = combo de cada burger (o vacío)
--   valor    = precio del paquete
-- Solo hay que permitir el tipo nuevo.
-- =====================================================================

alter table public.promociones drop constraint if exists promociones_tipo_check;
alter table public.promociones add constraint promociones_tipo_check
  check (tipo in ('porcentaje', 'valor', 'precio', 'incentivo', 'regalo', 'paquete'));

-- Comprobación: debe mostrar la regla con 'paquete'
select pg_get_constraintdef(oid) as regla
from pg_constraint where conname = 'promociones_tipo_check';
