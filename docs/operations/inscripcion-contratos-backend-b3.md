# Contratos y notas B3

- Nuevos códigos: 413 CUERPO_DEMASIADO_GRANDE y 400 JSON_INVALIDO en /solicitudes, /public/inscripcion,
  /admin/solicitudes y /admin/inscripciones (límite JSON 16 kb). El frontend no los mapea aún.
- Todas las respuestas llevan Cache-Control: no-store; CORS usa el origen de FRONTEND_URL.
- `npm run security:routes`: ver progreso F22. Tras unir ramas, rutas públicas nuevas deben añadirse a
  src/config/publicRoutes.ts; guards nuevos deben usar markGuard (utils/routeGuards.ts).
- Búsqueda q: usar utils/postgrestSearch.buildIlikeOr en cualquier .or/.ilike.
- EMAIL_PROVIDER=gmail_api: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (alcance gmail.send).
- Frontend vs brief: sin contradicciones detectadas en lo que toca B3.
- Revisión del historial: ver progreso F24 (sin credenciales).
