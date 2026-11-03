-- PASO A · Estructura, reglas, permisos y operación. Pegar completo en Supabase → SQL Editor → Run.

-- ======== 01_esquema.sql ========
-- =====================================================================
-- Plataforma de Campaña Veracruz · 01 Esquema
-- Ejecutar en Supabase → SQL Editor, en este orden: 01, 02, 03, 04, 05.
-- Varias campañas en la misma base, cada una con sus datos aislados.
-- No se guarda clave de elector, CURP ni imagen de credencial.
-- =====================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Tipos ----------
do $$ begin
  create type public.rol_campana as enum
    ('admin', 'coordinador', 'enlace', 'promotor', 'brigadista', 'capturista', 'representante', 'consulta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.nivel_compromiso as enum ('simpatizante', 'promotor', 'indeciso', 'no_localizado');
exception when duplicate_object then null; end $$;

-- ---------- Operadores de la plataforma ----------
-- Quien opera la plataforma (encargado del tratamiento). Solo ellos crean campañas.
create table if not exists public.plataforma_operadores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre  text not null,
  creado  timestamptz not null default now()
);

-- ---------- Territorio (datos públicos del INE) ----------
create table if not exists public.secciones (
  seccion           integer primary key,
  distrito_federal  smallint not null,
  distrito_local    smallint not null,
  municipio         smallint not null,
  municipio_nombre  text     not null,
  tipo              smallint,                 -- 1 urbana, 2 mixta, 3 rural
  ln_2026           integer,                  -- lista nominal, corte 15-oct-2026
  part_pres24       numeric(5,4),             -- participación por elección de referencia
  part_gub24        numeric(5,4),
  part_dl24         numeric(5,4),
  part_df24         numeric(5,4),
  part_ayu25        numeric(5,4),
  geom              extensions.geometry(MultiPolygon, 4326)
);
create index if not exists secciones_geom_idx on public.secciones using gist (geom);
create index if not exists secciones_dl_idx  on public.secciones (distrito_local);
create index if not exists secciones_df_idx  on public.secciones (distrito_federal);
create index if not exists secciones_mun_idx on public.secciones (municipio);

-- ---------- Campañas ----------
create table if not exists public.campanas (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null,
  cargo                 text not null check (cargo in ('gubernatura', 'diputacion_local', 'diputacion_federal', 'ayuntamiento', 'senaduria', 'otro')),
  anio                  smallint not null check (anio between 2026 and 2040),
  ambito_tipo           text not null check (ambito_tipo in ('estado', 'distrito_federal', 'distrito_local', 'municipio')),
  ambito_clave          smallint,
  eleccion_referencia   text not null default 'dl24' check (eleccion_referencia in ('pres24', 'gub24', 'dl24', 'df24', 'ayu25')),
  objetivo_pct          numeric(4,3) not null default 0.500 check (objetivo_pct between 0.05 and 0.95),
  fecha_eleccion        date,
  responsable_datos     text,                 -- nombre de la persona o entidad responsable
  aviso_privacidad_url  text,
  aviso_version         text not null default 'v1',
  fecha_borrado_datos   date,                 -- fecha comprometida para borrar la base
  activa                boolean not null default true,
  creada                timestamptz not null default now(),
  creada_por            uuid references auth.users (id)
);

-- Secciones que forman el ámbito de la campaña
create table if not exists public.campana_secciones (
  campana_id  uuid    not null references public.campanas (id) on delete cascade,
  seccion     integer not null references public.secciones (seccion),
  primary key (campana_id, seccion)
);

-- Bloques territoriales (agrupan secciones)
create table if not exists public.bloques (
  id          uuid primary key default gen_random_uuid(),
  campana_id  uuid not null references public.campanas (id) on delete cascade,
  nombre      text not null,
  unique (campana_id, nombre)
);
create table if not exists public.bloque_secciones (
  bloque_id   uuid    not null references public.bloques (id) on delete cascade,
  campana_id  uuid    not null references public.campanas (id) on delete cascade,
  seccion     integer not null,
  primary key (bloque_id, seccion),
  unique (campana_id, seccion),
  foreign key (campana_id, seccion) references public.campana_secciones (campana_id, seccion) on delete cascade
);

-- ---------- Equipo (usuarios de la app) ----------
create table if not exists public.miembros (
  id           uuid primary key default gen_random_uuid(),
  campana_id   uuid not null references public.campanas (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,   -- se vincula al iniciar sesión
  correo       text not null,
  nombre       text not null,
  telefono     text,
  rol          public.rol_campana not null,
  superior_id  uuid references public.miembros (id) on delete set null,
  persona_id   uuid,                                                 -- su registro como persona (promotores)
  activo       boolean not null default true,
  creado       timestamptz not null default now(),
  unique (campana_id, correo),
  unique (campana_id, user_id)
);
create index if not exists miembros_user_idx on public.miembros (user_id);
create index if not exists miembros_superior_idx on public.miembros (superior_id);

create table if not exists public.miembro_secciones (
  miembro_id  uuid    not null references public.miembros (id) on delete cascade,
  campana_id  uuid    not null references public.campanas (id) on delete cascade,
  seccion     integer not null,
  primary key (miembro_id, seccion),
  foreign key (campana_id, seccion) references public.campana_secciones (campana_id, seccion) on delete cascade
);
create index if not exists miembro_secciones_camp_idx on public.miembro_secciones (campana_id, seccion);

-- ---------- Personas (estructura territorial y redes afectivas) ----------
create table if not exists public.personas (
  id                    uuid primary key default gen_random_uuid(),
  campana_id            uuid not null references public.campanas (id) on delete cascade,
  nombre                text not null check (length(trim(nombre)) > 1),
  apellidos             text,
  telefono              text,
  telefono_norm         text generated always as (nullif(right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10), '')) stored,
  calle                 text,
  numero                text,
  colonia               text,
  codigo_postal         text,
  localidad             text,
  ubicacion             extensions.geometry(Point, 4326),
  precision_m           real,                                   -- precisión del GPS al capturar
  seccion               integer references public.secciones (seccion),
  seccion_origen        text check (seccion_origen in ('gps', 'manual')),
  seccion_fuera         boolean not null default false,         -- la sección declarada no coincide con el GPS
  compromiso            public.nivel_compromiso not null default 'simpatizante',
  es_promotor           boolean not null default false,
  meta_red              integer check (meta_red is null or meta_red between 0 and 10000),
  reclutado_por         uuid references public.personas (id) on delete set null,   -- árbol de reclutamiento
  registrado_por        uuid references public.miembros (id) on delete set null,   -- usuario que capturó
  origen                text not null default 'captura' check (origen in ('captura', 'invitacion', 'importacion')),
  consentimiento        boolean not null check (consentimiento),                   -- obligatorio: dato sensible
  consentimiento_fecha  timestamptz not null default now(),
  aviso_version         text not null,
  validado              boolean not null default false,
  validado_por          uuid references public.miembros (id) on delete set null,
  validado_fecha        timestamptz,
  duplicado_de          uuid references public.personas (id) on delete set null,
  notas                 text,
  creado                timestamptz not null default now(),
  actualizado           timestamptz not null default now(),
  borrado               timestamptz                                                -- baja lógica
);
create index if not exists personas_camp_sec_idx on public.personas (campana_id, seccion) where borrado is null;
create index if not exists personas_reclutado_idx on public.personas (reclutado_por);
create index if not exists personas_registrado_idx on public.personas (registrado_por);
create index if not exists personas_tel_idx on public.personas (campana_id, telefono_norm) where borrado is null;
create index if not exists personas_geo_idx on public.personas using gist (ubicacion);

alter table public.miembros
  drop constraint if exists miembros_persona_fk,
  add constraint miembros_persona_fk foreign key (persona_id) references public.personas (id) on delete set null;

-- Enlaces de invitación de cada promotor (red afectiva)
create table if not exists public.invitaciones (
  token       text primary key default replace(replace(encode(extensions.gen_random_bytes(12), 'base64'), '/', '_'), '+', '-'),
  campana_id  uuid not null references public.campanas (id) on delete cascade,
  persona_id  uuid not null references public.personas (id) on delete cascade,   -- el promotor dueño del enlace
  activa      boolean not null default true,
  usos        integer not null default 0,
  creado      timestamptz not null default now(),
  unique (campana_id, persona_id)
);

-- ---------- Comités ----------
create table if not exists public.comites (
  id            uuid primary key default gen_random_uuid(),
  campana_id    uuid not null references public.campanas (id) on delete cascade,
  seccion       integer not null,
  nombre        text not null,
  presidenta_id uuid references public.personas (id) on delete set null,
  ubicacion     extensions.geometry(Point, 4326),
  direccion     text,
  instalado     date,
  activo        boolean not null default true,
  creado_por    uuid references public.miembros (id) on delete set null,
  creado        timestamptz not null default now(),
  foreign key (campana_id, seccion) references public.campana_secciones (campana_id, seccion)
);
create table if not exists public.comite_integrantes (
  comite_id   uuid not null references public.comites (id) on delete cascade,
  persona_id  uuid not null references public.personas (id) on delete cascade,
  cargo       text,
  primary key (comite_id, persona_id)
);

-- ---------- Bitácora ----------
create table if not exists public.bitacora (
  id           bigserial primary key,
  campana_id   uuid references public.campanas (id) on delete cascade,
  user_id      uuid,
  accion       text not null,
  tabla        text,
  registro_id  uuid,
  detalle      jsonb,
  fecha        timestamptz not null default now()
);
create index if not exists bitacora_camp_idx on public.bitacora (campana_id, fecha desc);

-- ======== 02_funciones.sql ========
-- =====================================================================
-- Plataforma de Campaña Veracruz · 02 Funciones de apoyo y reglas automáticas
-- =====================================================================

-- ---------- ¿Quién soy en esta campaña? ----------
create or replace function public.es_operador() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plataforma_operadores where user_id = auth.uid());
$$;

create or replace function public.mi_miembro(p_campana uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from miembros where campana_id = p_campana and user_id = auth.uid() and activo limit 1;
$$;

create or replace function public.mi_rol(p_campana uuid) returns public.rol_campana
language sql stable security definer set search_path = public as $$
  select rol from miembros where campana_id = p_campana and user_id = auth.uid() and activo limit 1;
$$;

create or replace function public.es_miembro(p_campana uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where campana_id = p_campana and user_id = auth.uid() and activo);
$$;

create or replace function public.mi_superior(p_campana uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select superior_id from miembros where campana_id = p_campana and user_id = auth.uid() and activo limit 1;
$$;

-- Miembros a mi cargo (yo incluido), siguiendo la cadena de superiores
create or replace function public.mi_equipo(p_campana uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive eq as (
    select id from miembros where campana_id = p_campana and user_id = auth.uid() and activo
    union
    select m.id from miembros m join eq on m.superior_id = eq.id where m.campana_id = p_campana and m.activo
  ) select id from eq;
$$;

-- Secciones que puedo ver: todas si soy admin; si no, las asignadas a mí y a mi equipo
create or replace function public.mis_secciones(p_campana uuid) returns setof integer
language sql stable security definer set search_path = public as $$
  select cs.seccion from campana_secciones cs
   where cs.campana_id = p_campana and public.mi_rol(p_campana) = 'admin'
  union
  select ms.seccion from miembro_secciones ms
   where ms.campana_id = p_campana and ms.miembro_id in (select public.mi_equipo(p_campana));
$$;

-- Mi red afectiva: personas que registré yo o mi equipo, y todo el árbol que cuelga de mi persona
create or replace function public.mi_red(p_campana uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive raiz as (
    select persona_id as id from miembros
     where campana_id = p_campana and id in (select public.mi_equipo(p_campana)) and persona_id is not null
    union
    select id from personas
     where campana_id = p_campana and borrado is null and registrado_por in (select public.mi_equipo(p_campana))
  ), red as (
    select id from raiz
    union
    select p.id from personas p join red on p.reclutado_por = red.id
     where p.campana_id = p_campana and p.borrado is null
  ) select id from red;
$$;

create or replace function public.puede_ver_persona(p_campana uuid, p_seccion integer, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mi_rol(p_campana) is null then false
    when public.mi_rol(p_campana) = 'consulta' then false          -- consulta solo ve agregados
    when public.mi_rol(p_campana) = 'admin' then true
    else (p_seccion in (select public.mis_secciones(p_campana))) or (p_id in (select public.mi_red(p_campana)))
  end;
$$;

-- ---------- Asignar sección desde el GPS ----------
create or replace function public.seccion_en_punto(p_punto extensions.geometry) returns integer
language sql stable set search_path = public, extensions as $$
  select seccion from secciones where geom is not null and st_contains(geom, p_punto) limit 1;
$$;

-- ---------- Regla automática al guardar una persona ----------
create or replace function public.tg_personas_antes() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_gps integer;
begin
  if tg_op = 'INSERT' then
    -- quien captura queda registrado, salvo registros por invitación (sin sesión)
    if new.origen <> 'invitacion' then
      new.registrado_por := coalesce(public.mi_miembro(new.campana_id), new.registrado_por);
    end if;
    new.consentimiento_fecha := now();
  else
    -- campos que no se pueden alterar después del registro
    new.campana_id := old.campana_id;
    new.registrado_por := old.registrado_por;
    new.consentimiento := old.consentimiento;
    new.consentimiento_fecha := old.consentimiento_fecha;
    new.aviso_version := old.aviso_version;
    new.origen := old.origen;
    new.creado := old.creado;
  end if;

  -- sección por GPS; si se capturó a mano y no coincide, se marca
  if new.ubicacion is not null then
    new.ubicacion := st_setsrid(new.ubicacion, 4326);
    v_gps := public.seccion_en_punto(new.ubicacion);
    if v_gps is not null then
      if new.seccion is not null and new.seccion <> v_gps and new.seccion_origen = 'manual' then
        new.seccion_fuera := true;
      else
        new.seccion := v_gps;
        new.seccion_origen := 'gps';
        new.seccion_fuera := false;
      end if;
    end if;
  elsif new.seccion is not null and new.seccion_origen is null then
    new.seccion_origen := 'manual';
  end if;

  -- sección fuera del ámbito de la campaña
  if new.seccion is not null and not exists
     (select 1 from campana_secciones where campana_id = new.campana_id and seccion = new.seccion) then
    new.seccion_fuera := true;
  end if;

  -- posible duplicado por teléfono dentro de la misma campaña
  if new.telefono_norm is not null or new.telefono is not null then
    select id into new.duplicado_de from personas
     where campana_id = new.campana_id and borrado is null
       and telefono_norm = nullif(right(regexp_replace(coalesce(new.telefono, ''), '\D', '', 'g'), 10), '')
       and id <> new.id
       and (creado < new.creado or (creado = new.creado and id < new.id))   -- solo registros anteriores
     order by creado limit 1;
  end if;

  -- validación: solo quien valida queda registrado
  if new.validado and (tg_op = 'INSERT' or not old.validado) then
    new.validado_por := public.mi_miembro(new.campana_id);
    new.validado_fecha := now();
  elsif not new.validado then
    new.validado_por := null; new.validado_fecha := null;
  end if;

  -- no se puede reclutar a sí mismo ni formar ciclos
  if new.reclutado_por is not null then
    if new.reclutado_por = new.id or exists (
      with recursive arriba as (
        select reclutado_por as id from personas where id = new.reclutado_por
        union
        select p.reclutado_por from personas p join arriba on p.id = arriba.id where p.reclutado_por is not null
      ) select 1 from arriba where id = new.id) then
      raise exception 'El reclutamiento formaría un ciclo en la red';
    end if;
    if not exists (select 1 from personas where id = new.reclutado_por and campana_id = new.campana_id) then
      raise exception 'El promotor no pertenece a esta campaña';
    end if;
  end if;

  if new.es_promotor and new.compromiso = 'simpatizante' then new.compromiso := 'promotor'; end if;
  new.actualizado := now();
  return new;
end $$;

drop trigger if exists personas_antes on public.personas;
create trigger personas_antes before insert or update on public.personas
  for each row execute function public.tg_personas_antes();

-- ---------- Bitácora automática ----------
create or replace function public.tg_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_old jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  insert into bitacora (campana_id, user_id, accion, tabla, registro_id, detalle)
  values ((v_row ->> 'campana_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid,
          -- solo los NOMBRES de los campos cambiados: la bitácora no duplica datos personales
          case when tg_op = 'UPDATE' then
            jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(v_row) k
              where v_row -> k is distinct from v_old -> k and k not in ('actualizado')))
          else null end);
  return null;
end $$;

drop trigger if exists personas_bitacora on public.personas;
create trigger personas_bitacora after insert or update or delete on public.personas
  for each row execute function public.tg_bitacora();
drop trigger if exists miembros_bitacora on public.miembros;
create trigger miembros_bitacora after insert or update or delete on public.miembros
  for each row execute function public.tg_bitacora();
drop trigger if exists comites_bitacora on public.comites;
create trigger comites_bitacora after insert or update or delete on public.comites
  for each row execute function public.tg_bitacora();

-- ---------- Miembros: coherencia ----------
create or replace function public.tg_miembros_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.correo := lower(trim(new.correo));
  if new.superior_id is not null and not exists
     (select 1 from miembros where id = new.superior_id and campana_id = new.campana_id) then
    raise exception 'El superior debe pertenecer a la misma campaña';
  end if;
  if tg_op = 'UPDATE' then new.campana_id := old.campana_id; end if;
  return new;
end $$;
drop trigger if exists miembros_antes on public.miembros;
create trigger miembros_antes before insert or update on public.miembros
  for each row execute function public.tg_miembros_antes();

-- ======== 03_seguridad.sql ========
-- =====================================================================
-- Plataforma de Campaña Veracruz · 03 Permisos (seguridad por fila)
-- Los permisos se aplican en la base de datos: aunque alguien manipule
-- la app, el servidor solo entrega lo que su rol y su territorio permiten.
-- =====================================================================

alter table public.plataforma_operadores enable row level security;
alter table public.secciones             enable row level security;
alter table public.campanas              enable row level security;
alter table public.campana_secciones     enable row level security;
alter table public.bloques               enable row level security;
alter table public.bloque_secciones      enable row level security;
alter table public.miembros              enable row level security;
alter table public.miembro_secciones     enable row level security;
alter table public.personas              enable row level security;
alter table public.invitaciones          enable row level security;
alter table public.comites               enable row level security;
alter table public.comite_integrantes    enable row level security;
alter table public.bitacora              enable row level security;

-- Nadie anónimo lee ni escribe tablas directamente (el registro por invitación usa una función controlada)
revoke all on all tables in schema public from anon;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- Operadores ----------
drop policy if exists op_select on public.plataforma_operadores;
create policy op_select on public.plataforma_operadores for select to authenticated using (user_id = auth.uid());

-- ---------- Secciones: catálogo público de solo lectura ----------
grant select on public.secciones to anon;
drop policy if exists sec_select on public.secciones;
create policy sec_select on public.secciones for select to anon, authenticated using (true);

-- ---------- Campañas ----------
drop policy if exists camp_select on public.campanas;
create policy camp_select on public.campanas for select to authenticated
  using (public.es_miembro(id) or public.es_operador());
drop policy if exists camp_update on public.campanas;
create policy camp_update on public.campanas for update to authenticated
  using (public.mi_rol(id) = 'admin' or public.es_operador())
  with check (public.mi_rol(id) = 'admin' or public.es_operador());
-- las campañas se crean con la función crear_campana (solo operadores)

drop policy if exists cs_select on public.campana_secciones;
create policy cs_select on public.campana_secciones for select to authenticated
  using (public.es_miembro(campana_id) or public.es_operador());

-- ---------- Bloques ----------
drop policy if exists bl_select on public.bloques;
create policy bl_select on public.bloques for select to authenticated using (public.es_miembro(campana_id));
drop policy if exists bl_write on public.bloques;
create policy bl_write on public.bloques for all to authenticated
  using (public.mi_rol(campana_id) in ('admin', 'coordinador'))
  with check (public.mi_rol(campana_id) in ('admin', 'coordinador'));

drop policy if exists bs_select on public.bloque_secciones;
create policy bs_select on public.bloque_secciones for select to authenticated using (public.es_miembro(campana_id));
drop policy if exists bs_write on public.bloque_secciones;
create policy bs_write on public.bloque_secciones for all to authenticated
  using (public.mi_rol(campana_id) in ('admin', 'coordinador'))
  with check (public.mi_rol(campana_id) in ('admin', 'coordinador'));

-- ---------- Equipo ----------
-- Cada quien ve a su equipo hacia abajo y a su superior inmediato; admin ve a todos
drop policy if exists mi_select on public.miembros;
create policy mi_select on public.miembros for select to authenticated using (
  user_id = auth.uid()
  or public.mi_rol(campana_id) = 'admin'
  or id in (select public.mi_equipo(campana_id))
  or id = public.mi_superior(campana_id)
  or public.es_operador()
);
-- admin da de alta a cualquiera; coordinador y enlace solo dentro de su equipo
drop policy if exists mi_insert on public.miembros;
create policy mi_insert on public.miembros for insert to authenticated with check (
  public.mi_rol(campana_id) = 'admin'
  or (public.mi_rol(campana_id) in ('coordinador', 'enlace')
      and superior_id in (select public.mi_equipo(campana_id))
      and rol not in ('admin', 'coordinador'))
  or public.es_operador()
);
drop policy if exists mi_update on public.miembros;
create policy mi_update on public.miembros for update to authenticated using (
  public.mi_rol(campana_id) = 'admin'
  or (public.mi_rol(campana_id) in ('coordinador', 'enlace') and id in (select public.mi_equipo(campana_id)) and id <> public.mi_miembro(campana_id))
  or public.es_operador()
) with check (
  public.mi_rol(campana_id) = 'admin'
  or (public.mi_rol(campana_id) in ('coordinador', 'enlace') and rol not in ('admin', 'coordinador'))
  or public.es_operador()
);

drop policy if exists ms_select on public.miembro_secciones;
create policy ms_select on public.miembro_secciones for select to authenticated using (
  public.mi_rol(campana_id) = 'admin' or miembro_id in (select public.mi_equipo(campana_id))
);
drop policy if exists ms_write on public.miembro_secciones;
create policy ms_write on public.miembro_secciones for all to authenticated using (
  public.mi_rol(campana_id) = 'admin'
  or (public.mi_rol(campana_id) in ('coordinador', 'enlace')
      and miembro_id in (select public.mi_equipo(campana_id)) and miembro_id <> public.mi_miembro(campana_id)
      and seccion in (select public.mis_secciones(campana_id)))
) with check (
  public.mi_rol(campana_id) = 'admin'
  or (public.mi_rol(campana_id) in ('coordinador', 'enlace')
      and miembro_id in (select public.mi_equipo(campana_id)) and miembro_id <> public.mi_miembro(campana_id)
      and seccion in (select public.mis_secciones(campana_id)))
);

-- ---------- Personas ----------
drop policy if exists pe_select on public.personas;
create policy pe_select on public.personas for select to authenticated
  using (public.puede_ver_persona(campana_id, seccion, id));

drop policy if exists pe_insert on public.personas;
create policy pe_insert on public.personas for insert to authenticated with check (
  public.mi_rol(campana_id) in ('admin', 'coordinador', 'enlace', 'promotor', 'brigadista', 'capturista')
  and consentimiento
);

drop policy if exists pe_update on public.personas;
create policy pe_update on public.personas for update to authenticated
  using (public.puede_ver_persona(campana_id, seccion, id)
         and public.mi_rol(campana_id) in ('admin', 'coordinador', 'enlace', 'promotor', 'capturista'))
  with check (public.mi_rol(campana_id) in ('admin', 'coordinador', 'enlace', 'promotor', 'capturista'));

-- Borrado definitivo solo por admin (atención a solicitudes de cancelación); lo normal es la baja lógica
drop policy if exists pe_delete on public.personas;
create policy pe_delete on public.personas for delete to authenticated using (public.mi_rol(campana_id) = 'admin');

-- ---------- Invitaciones (enlaces de promotor) ----------
drop policy if exists inv_select on public.invitaciones;
create policy inv_select on public.invitaciones for select to authenticated
  using (public.mi_rol(campana_id) = 'admin' or persona_id in (select public.mi_red(campana_id)));
-- se crean con la función crear_invitacion

-- ---------- Comités ----------
drop policy if exists co_select on public.comites;
create policy co_select on public.comites for select to authenticated using (
  public.mi_rol(campana_id) in ('admin', 'consulta') or seccion in (select public.mis_secciones(campana_id))
);
drop policy if exists co_write on public.comites;
create policy co_write on public.comites for all to authenticated using (
  public.mi_rol(campana_id) = 'admin'
  or (public.mi_rol(campana_id) in ('coordinador', 'enlace') and seccion in (select public.mis_secciones(campana_id)))
) with check (
  public.mi_rol(campana_id) = 'admin'
  or (public.mi_rol(campana_id) in ('coordinador', 'enlace') and seccion in (select public.mis_secciones(campana_id)))
);

drop policy if exists ci_select on public.comite_integrantes;
create policy ci_select on public.comite_integrantes for select to authenticated using (
  exists (select 1 from public.comites c where c.id = comite_id
          and (public.mi_rol(c.campana_id) = 'admin' or c.seccion in (select public.mis_secciones(c.campana_id))))
);
drop policy if exists ci_write on public.comite_integrantes;
create policy ci_write on public.comite_integrantes for all to authenticated using (
  exists (select 1 from public.comites c where c.id = comite_id
          and (public.mi_rol(c.campana_id) = 'admin'
               or (public.mi_rol(c.campana_id) in ('coordinador', 'enlace') and c.seccion in (select public.mis_secciones(c.campana_id)))))
) with check (
  exists (select 1 from public.comites c where c.id = comite_id
          and (public.mi_rol(c.campana_id) = 'admin'
               or (public.mi_rol(c.campana_id) in ('coordinador', 'enlace') and c.seccion in (select public.mis_secciones(c.campana_id)))))
);

-- ---------- Bitácora: solo lectura para admin y operador ----------
drop policy if exists bi_select on public.bitacora;
create policy bi_select on public.bitacora for select to authenticated
  using (public.mi_rol(campana_id) = 'admin' or public.es_operador());
revoke insert, update, delete on public.bitacora from authenticated;


-- ======== 04_operacion.sql ========
-- =====================================================================
-- Plataforma de Campaña Veracruz · 04 Operación: altas, invitaciones,
-- metas, avance y redes afectivas
-- =====================================================================

-- ---------- Crear campaña (solo operadores de la plataforma) ----------
create or replace function public.crear_campana(
  p_nombre text, p_cargo text, p_anio smallint, p_ambito_tipo text, p_ambito_clave smallint,
  p_eleccion_referencia text default 'dl24', p_objetivo numeric default 0.5, p_fecha_eleccion date default null,
  p_responsable text default null, p_admin_correo text default null, p_admin_nombre text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n integer;
begin
  if not public.es_operador() then raise exception 'Solo el operador de la plataforma puede crear campañas'; end if;
  insert into campanas (nombre, cargo, anio, ambito_tipo, ambito_clave, eleccion_referencia, objetivo_pct, fecha_eleccion, responsable_datos, creada_por)
  values (p_nombre, p_cargo, p_anio, p_ambito_tipo, p_ambito_clave, p_eleccion_referencia, p_objetivo, p_fecha_eleccion, p_responsable, auth.uid())
  returning id into v_id;

  insert into campana_secciones (campana_id, seccion)
  select v_id, seccion from secciones
   where case p_ambito_tipo
           when 'estado' then true
           when 'distrito_federal' then distrito_federal = p_ambito_clave
           when 'distrito_local' then distrito_local = p_ambito_clave
           when 'municipio' then municipio = p_ambito_clave end;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'El ámbito % % no tiene secciones', p_ambito_tipo, p_ambito_clave; end if;

  -- administrador de la campaña: la persona indicada o, si no se indica, el operador
  insert into miembros (campana_id, user_id, correo, nombre, rol)
  values (v_id,
          case when p_admin_correo is null then auth.uid() end,
          coalesce(p_admin_correo, auth.jwt() ->> 'email', 'operador@plataforma'),
          coalesce(p_admin_nombre, 'Administración de campaña'), 'admin');
  return v_id;
end $$;

-- ---------- Vincular la cuenta al iniciar sesión ----------
-- Un usuario dado de alta por correo queda ligado a su cuenta la primera vez que entra.
create or replace function public.vincular_cuenta() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update miembros set user_id = auth.uid()
   where user_id is null and correo = lower(auth.jwt() ->> 'email') and activo;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Mis campañas y mi rol en cada una
create or replace function public.mis_campanas()
returns table (campana_id uuid, nombre text, cargo text, anio smallint, rol public.rol_campana, miembro_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.nombre, c.cargo, c.anio, m.rol, m.id
    from miembros m join campanas c on c.id = m.campana_id
   where m.user_id = auth.uid() and m.activo and c.activa
   order by c.creada desc;
$$;

-- ---------- Invitaciones de promotor ----------
create or replace function public.crear_invitacion(p_persona uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_camp uuid; v_sec integer; v_token text;
begin
  select campana_id, seccion into v_camp, v_sec from personas where id = p_persona and borrado is null;
  if v_camp is null or not public.puede_ver_persona(v_camp, v_sec, p_persona)
     or public.mi_rol(v_camp) not in ('admin', 'coordinador', 'enlace', 'promotor') then
    raise exception 'Sin permiso para generar el enlace de esta persona';
  end if;
  update personas set es_promotor = true where id = p_persona;
  insert into invitaciones (campana_id, persona_id) values (v_camp, p_persona)
  on conflict (campana_id, persona_id) do update set activa = true
  returning token into v_token;
  return v_token;
end $$;

-- Datos que ve quien abre un enlace de invitación (sin iniciar sesión)
create or replace function public.datos_invitacion(p_token text)
returns table (campana text, promotor text, aviso_privacidad_url text, aviso_version text, responsable text)
language sql stable security definer set search_path = public as $$
  select c.nombre, split_part(p.nombre, ' ', 1), c.aviso_privacidad_url, c.aviso_version, c.responsable_datos
    from invitaciones i join campanas c on c.id = i.campana_id join personas p on p.id = i.persona_id
   where i.token = p_token and i.activa and c.activa;
$$;

-- Registro con el enlace de un promotor (sin cuenta). Exige consentimiento expreso.
create or replace function public.registrar_por_invitacion(
  p_token text, p_nombre text, p_apellidos text, p_telefono text,
  p_calle text, p_numero text, p_colonia text, p_codigo_postal text,
  p_lat double precision, p_lon double precision, p_precision real,
  p_consentimiento boolean, p_quiere_promover boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_inv invitaciones; v_camp campanas; v_id uuid; v_hoy integer; v_token text; v_dup uuid;
begin
  if coalesce(p_consentimiento, false) is not true then
    raise exception 'Se requiere el consentimiento para registrar los datos';
  end if;
  select * into v_inv from invitaciones where token = p_token and activa;
  if v_inv.token is null then raise exception 'El enlace no es válido o fue desactivado'; end if;
  select * into v_camp from campanas where id = v_inv.campana_id and activa;
  if v_camp.id is null then raise exception 'La campaña no está activa'; end if;

  -- límite contra abuso: 150 registros por enlace por día
  select count(*) into v_hoy from personas
   where reclutado_por = v_inv.persona_id and origen = 'invitacion' and creado > now() - interval '1 day';
  if v_hoy >= 150 then raise exception 'Este enlace alcanzó su límite diario'; end if;

  insert into personas (campana_id, nombre, apellidos, telefono, calle, numero, colonia, codigo_postal,
                        ubicacion, precision_m, reclutado_por, origen, consentimiento, aviso_version, es_promotor)
  values (v_camp.id, trim(p_nombre), nullif(trim(p_apellidos), ''), p_telefono, p_calle, p_numero, p_colonia, p_codigo_postal,
          case when p_lat is not null and p_lon is not null then st_setsrid(st_makepoint(p_lon, p_lat), 4326) end,
          p_precision, v_inv.persona_id, 'invitacion', true, v_camp.aviso_version, coalesce(p_quiere_promover, false))
  returning id, duplicado_de into v_id, v_dup;

  update invitaciones set usos = usos + 1 where token = p_token;

  if p_quiere_promover then
    insert into invitaciones (campana_id, persona_id) values (v_camp.id, v_id) returning token into v_token;
  end if;
  return jsonb_build_object('ok', true, 'token_promotor', v_token);
end $$;

-- ---------- Metas y avance por sección ----------
-- Meta = lista nominal 2026 × participación de la elección de referencia × porcentaje objetivo
create or replace function public.avance_secciones(p_campana uuid)
returns table (seccion integer, municipio text, bloque text, ln_2026 integer, participacion_ref numeric, meta integer,
               registrados integer, validados integer, promotores integer, comites integer, avance numeric)
language sql stable security definer set search_path = public as $$
  with c as (select * from campanas where id = p_campana),
  vis as (
    select cs.seccion from campana_secciones cs
     where cs.campana_id = p_campana
       and (public.mi_rol(p_campana) in ('admin', 'consulta') or cs.seccion in (select public.mis_secciones(p_campana)))
  ),
  pe as (
    select p.seccion, count(*) n, count(*) filter (where p.validado) v, count(*) filter (where p.es_promotor) pr
      from personas p where p.campana_id = p_campana and p.borrado is null and p.duplicado_de is null
     group by p.seccion
  ),
  co as (select cm.seccion, count(*) n from comites cm where cm.campana_id = p_campana and cm.activo group by cm.seccion)
  select s.seccion, s.municipio_nombre, b.nombre, s.ln_2026,
         case c.eleccion_referencia when 'pres24' then s.part_pres24 when 'gub24' then s.part_gub24
              when 'dl24' then s.part_dl24 when 'df24' then s.part_df24 else s.part_ayu25 end,
         round(coalesce(s.ln_2026, 0) * coalesce(case c.eleccion_referencia when 'pres24' then s.part_pres24 when 'gub24' then s.part_gub24
              when 'dl24' then s.part_dl24 when 'df24' then s.part_df24 else s.part_ayu25 end, 0.55) * c.objetivo_pct)::int,
         coalesce(pe.n, 0)::int, coalesce(pe.v, 0)::int, coalesce(pe.pr, 0)::int, coalesce(co.n, 0)::int, null::numeric
    from vis join secciones s on s.seccion = vis.seccion cross join c
    left join pe on pe.seccion = s.seccion
    left join co on co.seccion = s.seccion
    left join bloque_secciones bs on bs.campana_id = p_campana and bs.seccion = s.seccion
    left join bloques b on b.id = bs.bloque_id
   order by s.seccion;
$$;

-- Resumen para las tarjetas del dashboard, con ritmo y proyección
create or replace function public.resumen_campana(p_campana uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c campanas; v_meta bigint; v_reg bigint; v_val bigint; v_prom bigint; v_14 bigint; v_com bigint; v_secc integer;
  v_dias integer; v_ritmo numeric; v_proy numeric; v_nec numeric;
begin
  if public.mi_rol(p_campana) is null and not public.es_operador() then raise exception 'Sin acceso a esta campaña'; end if;
  select * into v_c from campanas where id = p_campana;
  select sum(meta), sum(registrados), sum(validados), sum(promotores), sum(comites), count(*)
    into v_meta, v_reg, v_val, v_prom, v_com, v_secc from public.avance_secciones(p_campana);
  select count(*) into v_14 from personas p
   where p.campana_id = p_campana and p.borrado is null and p.duplicado_de is null and p.creado > now() - interval '14 days'
     and (public.mi_rol(p_campana) in ('admin', 'consulta') or p.seccion in (select public.mis_secciones(p_campana)));
  v_ritmo := round(v_14 / 14.0, 1);
  v_dias := greatest(0, v_c.fecha_eleccion - current_date);
  v_proy := case when v_c.fecha_eleccion is null then null else v_reg + v_ritmo * v_dias end;
  v_nec := case when v_dias > 0 then round(greatest(0, v_meta - v_reg)::numeric / v_dias, 1) end;
  return jsonb_build_object(
    'campana', v_c.nombre, 'secciones', v_secc, 'dias_restantes', v_dias,
    'estructura', jsonb_build_object('meta', v_meta, 'registrados', v_reg, 'validados', v_val,
        'ritmo_diario_14d', v_ritmo, 'necesario_diario', v_nec, 'proyeccion_dia_eleccion', round(v_proy)),
    'redes', jsonb_build_object('promotores', v_prom),
    'comites', jsonb_build_object('instalados', v_com, 'meta', v_secc),
    'brigadas', null, 'call_center', null, 'sociedad_civil', null   -- módulos de fases siguientes
  );
end $$;

-- ---------- Redes afectivas ----------
-- Top de promotores: registros directos, red total y porcentaje validado
create or replace function public.top_promotores(p_campana uuid, p_n integer default 10)
returns table (persona_id uuid, nombre text, seccion integer, directos integer, red_total integer, validados integer, pct_validado numeric, meta_red integer)
language sql stable security definer set search_path = public as $$
  with recursive arbol as (
    select p.id as raiz, p.id from personas p
     where p.campana_id = p_campana and p.es_promotor and p.borrado is null
    union all
    select a.raiz, h.id from personas h join arbol a on h.reclutado_por = a.id
     where h.campana_id = p_campana and h.borrado is null and h.duplicado_de is null
  )
  select p.id, p.nombre || coalesce(' ' || left(p.apellidos, 1) || '.', ''), p.seccion,
         (select count(*) from personas d where d.reclutado_por = p.id and d.borrado is null and d.duplicado_de is null)::int,
         (count(*) - 1)::int,
         (count(*) filter (where q.validado and q.id <> p.id))::int,
         round(100.0 * count(*) filter (where q.validado and q.id <> p.id) / nullif(count(*) - 1, 0), 1),
         p.meta_red
    from arbol a join personas p on p.id = a.raiz join personas q on q.id = a.id
   where public.mi_rol(p_campana) is not null
   group by p.id
   order by count(*) filter (where q.validado) desc, count(*) desc
   limit p_n;
$$;

-- Árbol de reclutamiento a partir de una persona
create or replace function public.arbol_red(p_persona uuid)
returns table (persona_id uuid, reclutado_por uuid, nivel integer, nombre text, seccion integer, es_promotor boolean, validado boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_camp uuid; v_sec integer;
begin
  select p.campana_id, p.seccion into v_camp, v_sec from personas p where p.id = p_persona;
  if v_camp is null or not public.puede_ver_persona(v_camp, v_sec, p_persona) then
    raise exception 'Sin permiso para ver esta red';
  end if;
  return query
  with recursive r as (
    select p.id, p.reclutado_por, 0 as nivel from personas p where p.id = p_persona
    union all
    select h.id, h.reclutado_por, r.nivel + 1 from personas h join r on h.reclutado_por = r.id
     where h.borrado is null and r.nivel < 12
  )
  select r.id, r.reclutado_por, r.nivel, p.nombre || coalesce(' ' || p.apellidos, ''), p.seccion, p.es_promotor, p.validado
    from r join personas p on p.id = r.id order by r.nivel, p.nombre;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.datos_invitacion(text) to anon;
grant execute on function public.registrar_por_invitacion(text, text, text, text, text, text, text, text, double precision, double precision, real, boolean, boolean) to anon;
