# Plataforma de Campaña · Fase 1

Estructura territorial y redes afectivas para campañas de 2027 y 2030. App web instalable que funciona en el celular, incluso sin señal para capturar.

- **App:** archivos de esta carpeta, publicados con GitHub Pages.
- **Datos:** viven en Supabase, protegidos por permisos por fila. Este repositorio no contiene datos personales.
- **`config.js`:** dirección del proyecto y llave publicable. Es pública por diseño; nunca se coloca aquí la llave secreta ni la `service_role`.
- **`base-de-datos/`:** scripts para crear la base desde cero (A estructura, B territorio, C operador, D ajustes), en ese orden.

## Fase 1 incluye
Acceso por correo, tablero con metas por sección y ritmo, registro con GPS y cola sin señal, validación y duplicados, enlaces de promotor con QR, árbol de reclutamiento, top 10, mapa de avance, alta de equipo por territorio y formulario público de invitación con aviso de privacidad y consentimiento.

## Publicar una versión nueva
Cambia `VERSION` en `sw.js` y `version` en `config.js`, y sube los cambios.
