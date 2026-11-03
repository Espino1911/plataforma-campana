-- PASO D · Ajustes para la app (coordenadas, contacto de privacidad, equipo y enlace propio). Pegar completo en SQL Editor → Run.
-- =====================================================================
-- Plataforma de Campaña Veracruz · 07 Ajustes para la app (Fase 1)
-- =====================================================================

-- Coordenadas legibles para la app (se calculan solas a partir de la ubicación)
alter table public.personas add column if not exists lat double precision generated always as (extensions.st_y(ubicacion)) stored;
alter table public.personas add column if not exists lon double precision generated always as (extensions.st_x(ubicacion)) stored;
alter table public.comites  add column if not exists lat double precision generated always as (extensions.st_y(ubicacion)) stored;
alter table public.comites  add column if not exists lon double precision generated always as (extensions.st_x(ubicacion)) stored;

-- Contacto para ejercer derechos de acceso, rectificación, cancelación y oposición
alter table public.campanas add column if not exists contacto_privacidad text;

drop function if exists public.datos_invitacion(text);
create or replace function public.datos_invitacion(p_token text)
returns table (campana text, promotor text, aviso_privacidad_url text, aviso_version text, responsable text, contacto_privacidad text)
language sql stable security definer set search_path = public as $$
  select c.nombre, split_part(p.nombre, ' ', 1), c.aviso_privacidad_url, c.aviso_version, c.responsable_datos, c.contacto_privacidad
    from invitaciones i join campanas c on c.id = i.campana_id join personas p on p.id = i.persona_id
   where i.token = p_token and i.activa and c.activa;
$$;
revoke execute on function public.datos_invitacion(text) from public;
grant execute on function public.datos_invitacion(text) to anon, authenticated;

-- Equipo con número de secciones asignadas
create or replace function public.equipo_campana(p_campana uuid)
returns table (id uuid, nombre text, correo text, telefono text, rol public.rol_campana, superior_id uuid, superior text,
               activo boolean, vinculado boolean, secciones integer, persona_id uuid)
language sql stable security definer set search_path = public as $$
  select m.id, m.nombre, m.correo, m.telefono, m.rol, m.superior_id, s.nombre, m.activo, m.user_id is not null,
         (select count(*) from miembro_secciones ms where ms.miembro_id = m.id)::int, m.persona_id
    from miembros m left join miembros s on s.id = m.superior_id
   where m.campana_id = p_campana
     and (public.mi_rol(p_campana) = 'admin' or m.id in (select public.mi_equipo(p_campana)) or public.es_operador())
   order by m.rol, m.nombre;
$$;
revoke execute on function public.equipo_campana(uuid) from public, anon;
grant execute on function public.equipo_campana(uuid) to authenticated;

-- Secciones que puede asignar quien llama (las suyas, o todas si es admin)
create or replace function public.secciones_asignables(p_campana uuid) returns setof integer
language sql stable security definer set search_path = public as $$
  select public.mis_secciones(p_campana);
$$;
revoke execute on function public.secciones_asignables(uuid) from public, anon;
grant execute on function public.secciones_asignables(uuid) to authenticated;

-- Para que un promotor que entra a la app obtenga su propio enlace sin intermediarios
create or replace function public.mi_enlace(p_campana uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_m miembros; v_p uuid; v_tok text;
begin
  select * into v_m from miembros where campana_id = p_campana and user_id = auth.uid() and activo;
  if v_m.id is null then raise exception 'No perteneces a esta campaña'; end if;
  v_p := v_m.persona_id;
  if v_p is null then
    insert into personas (campana_id, nombre, telefono, consentimiento, aviso_version, es_promotor, origen)
    values (p_campana, v_m.nombre, v_m.telefono, true, (select aviso_version from campanas where id = p_campana), true, 'captura')
    returning id into v_p;
    update miembros set persona_id = v_p where id = v_m.id;
  end if;
  update personas set es_promotor = true where id = v_p;
  insert into invitaciones (campana_id, persona_id) values (p_campana, v_p)
  on conflict (campana_id, persona_id) do update set activa = true
  returning token into v_tok;
  return v_tok;
end $$;
revoke execute on function public.mi_enlace(uuid) from public, anon;
grant execute on function public.mi_enlace(uuid) to authenticated;
