# Reportes y exportación (RF-08 · CD-346)

Decisiones y definiciones: [ADR 025](../adr/025-reportes-exportacion.md).

## Endpoints

Ambos exigen `Authorization: Bearer <JWT>` de un administrador (y segundo factor si `ADMIN_MFA_REQUIRED=true`).

| Método y ruta | Respuesta | Uso |
| --- | --- | --- |
| `GET /admin/reportes` | JSON con la estructura de reportes | Panel de CD-345 y vista previa |
| `GET /admin/reportes/exportar` | Archivo PDF o Excel | Descarga |

### Parámetros de consulta

| Parámetro | Obligatorio | Valores | Por defecto |
| --- | --- | --- | --- |
| `desde` | Sí | Fecha `AAAA-MM-DD` (hora de Ecuador) | — |
| `hasta` | Sí | Fecha `AAAA-MM-DD`, igual o posterior a `desde`; máximo 366 días de rango | — |
| `tipoCurso` | No | `A`, `B`, `todos` | `todos` |
| `cohorteId` | No | UUID de una cohorte existente y coherente con `tipoCurso` | todas |
| `tipo` | No | `matriculas`, `asistencia`, `examenes`, `finanzas`, `instructores`, `todos` | `todos` |
| `formato` | Solo en `/exportar` | `pdf`, `xlsx` | — |

Cualquier otro parámetro, o uno repetido, responde 400.

### Respuestas

| Código | Cuándo | `code` |
| --- | --- | --- |
| 200 | Reporte generado (también si no hay datos) | — |
| 400 | Filtro inválido; incluye `field` con el campo | `INVALID_FIELD`, `COHORTE_NO_ENCONTRADA`, `COHORTE_TIPO_INCOHERENTE` |
| 401 | Sin token o token inválido | — |
| 403 | Rol distinto de administrador, falta el segundo factor o falta el permiso financiero | `MFA_REQUERIDA`, `PERMISO_REQUERIDO` |
| 413 | Demasiados datos para el rango pedido | `REPORTE_DEMASIADOS_DATOS` |
| 429 | Límite de tasa o demasiadas exportaciones simultáneas | `LIMITE_PETICIONES`, `EXPORTACION_OCUPADA` |
| 503 | No se pudo leer la base o registrar la auditoría | `REPORTE_NO_DISPONIBLE`, `AUDITORIA_NO_DISPONIBLE` |

Cabeceras de la exportación: `Content-Type` (`application/pdf` o `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), `Content-Disposition: attachment; filename="reporte-<tipo>-<desde>_<hasta>.<ext>"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

### Estructura JSON (resumen)

```json
{
  "meta": {
    "school": "ColoradosDrive · Escuela de conducción",
    "title": "Finanzas",
    "generatedAt": "2026-11-15T15:30:00.000-05:00",
    "timezone": "America/Guayaquil",
    "generatedBy": { "name": "…", "role": "Administrador" },
    "filters": { "desde": "2026-11-01", "hasta": "2026-11-30", "tipoCurso": "todos", "cohorteId": null, "tipo": "finanzas" },
    "filterSummary": [{ "label": "Período", "value": "01/11/2026 al 30/11/2026 (hora de Ecuador)" }],
    "demoMode": false,
    "omitted": []
  },
  "reports": [
    {
      "type": "finanzas",
      "title": "Finanzas",
      "sheetName": "Finanzas",
      "columns": [{ "key": "ingresos", "label": "Ingresos confirmados", "kind": "money" }],
      "rows": [{ "cohorte": "…", "ingresos": 20010 }],
      "totals": { "cohorte": "Total", "ingresos": 40040 },
      "indicators": [{ "label": "Ingresos confirmados", "kind": "money", "value": 40040 }],
      "notes": ["…"],
      "chart": { "title": "…", "kind": "money", "items": [{ "label": "…", "value": 20010 }] },
      "rowCount": 2
    }
  ]
}
```

`kind` indica cómo presentar cada valor: `money` son centavos enteros (40040 = USD 400,40), `percent` es una proporción de 0 a 1 (`null` = «—»), `integer`, `decimal` y `text`.

## Auditoría

Consulta de las exportaciones registradas:

```sql
select occurred_at, actor_id, entity_id as tipo, new_value
from public.enrollment_domain_audit
where action = 'report_exported'
order by occurred_at desc
limit 50;
```

## Registro de tiempos

Cada exportación escribe una línea JSON `report_exported` con formato, tipo, filas, bytes y milisegundos (sin datos personales), útil para verificar RNF-02 en Railway.

## Ajustar los límites

Los valores están en `REPORT_LIMITS` (`src/routes/report.routes.ts`) y en las constantes `REPORT_MAX_*` de `src/services/report.service.ts`. El límite de tasa usa memoria del proceso (igual que el resto de `rateLimit.ts`): se reinicia con cada despliegue y no se comparte entre réplicas.
