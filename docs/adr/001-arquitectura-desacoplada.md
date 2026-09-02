# ADR 001: Arquitectura cliente-servidor desacoplada sobre monolito

## Estado

Aceptado.

## Contexto

ColoradosDrive necesita una arquitectura que soporte, entre otros requisitos: procesamiento de pagos (webhooks de Kushki con validación de firma criptográfica), notificaciones en tiempo real sobre inscripciones y cohortes (Supabase Realtime, vía WebSocket persistente), interfaces diferenciadas por rol (admin/estudiante/instructor) y evolución independiente de frontend y backend a lo largo de las 8 iteraciones (sprints) del proyecto.

Se evaluaron dos alternativas arquitectónicas:

1. **Cliente-servidor desacoplada**: frontend (Next.js) desplegado en Vercel, backend REST (Express/TypeScript) desplegado como proceso persistente en Railway, base de datos y Auth en Supabase.
2. **Monolítica**: Next.js con API Routes, frontend y backend en un mismo proceso, todo desplegado en Vercel (incluyendo funciones serverless para las API Routes).

## Decisión

Se eligió la **arquitectura cliente-servidor desacoplada**, desplegando el backend como proceso persistente en Railway (no serverless), precisamente porque debe mantener conexiones WebSocket abiertas con Supabase Realtime — algo que las funciones serverless no soportan de forma nativa (se reinician entre invocaciones y no mantienen conexiones persistentes).

### Matriz de decisión ponderada

Tomada de la Tabla 1 del documento de titulación ("Matriz de decisión ponderada para elección de la mejor solución"). Escala de puntaje: 1 (deficiente) a 5 (excelente).

| Criterio            | Peso | Cliente-servidor desacoplada | Monolítica |
| ------------------- | ---: | ---------------------------: | ---------: |
| Fiabilidad          |  35% |                            5 |          2 |
| Seguridad           |  20% |                            5 |          3 |
| Mantenibilidad      |  15% |                            5 |          2 |
| Usabilidad          |  15% |                            4 |          2 |
| Escalabilidad       |  15% |                            4 |          2 |
| **Total ponderado** |      |                     **4.70** |   **2.20** |

Fiabilidad y seguridad concentran el 55% del peso total, por ser los criterios más críticos dado que el sistema procesa pagos y datos académicos sensibles.

### Justificación por criterio

**Cliente-servidor desacoplada**

- **Fiabilidad (5)**: la separación entre frontend y backend permite que un fallo en la capa de presentación no afecte el procesamiento de pagos ni el registro de datos académicos. Los webhooks de Kushki se procesan en un backend dedicado. El sistema de notificaciones en tiempo real opera en un proceso independiente de Supabase Realtime.
- **Seguridad (5)**: la capa de backend permite implementar middleware de autenticación JWT y RBAC en cada endpoint, aislando la lógica de pagos y datos sensibles. El frontend nunca accede directo a la base de datos. Webhooks de Kushki con validación de firma criptográfica.
- **Mantenibilidad (5)**: cada nuevo módulo puede agregarse al backend sin afectar los existentes. Frontend y backend evolucionan en repositorios independientes. Despliegues desacoplados sin riesgo de regresiones cruzadas.
- **Usabilidad (4)**: facilita interfaces diferenciadas por rol con Next.js 16 + Tailwind 4, responsive. Server Components reduce el tiempo de carga inicial.
- **Escalabilidad (4)**: Vercel y Railway permiten escalar frontend y backend de forma independiente según la carga real de cada uno.

**Monolítica (Next.js con API Routes, todo en Vercel)**

- **Fiabilidad (2)**: una caída del proceso principal afecta simultáneamente frontend, backend y procesamiento de pagos. Tolerancia a fallos limitada.
- **Seguridad (3)**: la exposición conjunta de lógica de presentación y negocio amplía la superficie de ataque. Vulnerabilidades en renderizado pueden afectar endpoints de pago al compartir proceso y memoria.
- **Mantenibilidad (2)**: cualquier modificación implica desplegar todo el monolito. Acoplamiento entre API Routes y renderización dificulta el mantenimiento independiente.
- **Usabilidad (2)**: UI y lógica de negocio fuertemente acopladas. Cold starts serverless degradan la experiencia móvil.
- **Escalabilidad (2)**: escalar implica replicar todo el sistema en conjunto, sin escalabilidad asimétrica posible.

## Consecuencias

**Positivas**

- El backend puede mantener conexiones WebSocket persistentes con Supabase Realtime sin las limitaciones de un entorno serverless.
- Aislamiento de fallos: un problema en el frontend (Vercel) no compromete el procesamiento de pagos ni el backend.
- Despliegues y ciclos de vida independientes entre frontend y backend, alineado con la estructura de repos separados (`coloradosdrive-frontend`, `coloradosdrive-backend`).
- Superficie de ataque más controlada: el frontend nunca accede directamente a la base de datos; toda escritura/lectura sensible pasa por middleware de autenticación (JWT) y RBAC en el backend.

**Negativas / trade-offs asumidos**

- Mayor complejidad operativa: dos despliegues a coordinar (Vercel + Railway) en vez de uno solo.
- Requiere gestionar CORS explícitamente entre frontend y backend (ver `FRONTEND_URL` en `config/env.ts`).
- Railway, al ser un proceso persistente, tiene un modelo de costos distinto (no pay-per-invocation) al de las funciones serverless de Vercel.

## Alternativas descartadas

La arquitectura monolítica (Next.js API Routes en Vercel) se descartó por su bajo puntaje en fiabilidad y seguridad — los dos criterios de mayor peso (55% combinado) — y porque las funciones serverless de Vercel no sostienen conexiones WebSocket persistentes, requisito no negociable para Supabase Realtime.
