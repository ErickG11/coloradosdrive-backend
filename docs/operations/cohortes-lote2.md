# Lote 2 — calendario y plan común

Estado: 16 pruebas obligatorias TS/SQL y tipos de aplicación en ambos repositorios OK.
Doce duraciones en UNA prueba parametrizada usando el mismo JSON para TypeScript y SQL.
No se ejecutaron tests de componentes ni lint/build completos. UI manual pendiente.

Archivos: migración 070 y sus tres guiones; src/utils/enrollmentRules.ts,
src/config/cohortErrors.ts, servicio studentPlanRules y endpoint GET /estudiantes/inscripcion/horario/config;
contratos y tabla de duraciones en el selector existente; tests/fixtures/enrollment-plan-vectors.json,
tests/unit/enrollmentRulesSql.test.ts y manifiesto F45.

## Despliegue manual y rollback

Nunca ejecutado en remoto por el agente. Respaldar esquema/datos/ACL según guion del
lote 1 y comprobar restauración en copia local sanitizada. Ensayar 070 en esa copia,
verificación, rollback y reaplicación. Aplicar manualmente: preflight 070 → migración
070 completa → verificación 070 → código compatible. date_rules sigue enabled=false.
Para revertir, primero revertir los lotes dependientes, apagar indicadores y ejecutar
rollback 070. Se eliminan únicamente helpers nuevos y se restaura implemented=false;
no se borran datos históricos. La prueba obligatoria acredita reaplicación literal.

## QA manual

Base desechable: npm run qa:lote1. Comandos apply (069), apply 070, verify 070,
rollback 070, apply 070, verify 070; reset restablece fixtures de 068. Sin servidor remoto.

| Datos/pasos | Esperado | Restablecer |
| --- | --- | --- |
| Vectores de tests/fixtures/enrollment-plan-vectors.json | 15 horas, sesiones y fechas de fin aprobadas en TS y SQL | reset |
| Fin matrícula 15/11; consultar helper a 10/11 23:59:59 y 11/11 00:00 Guayaquil | Abierta y cerrada respectivamente | Solo lectura |
| Inicio hoy 06:00; reloj 05:59:59 y después 06:00 | Primero permitido, después PLAN_FRANJA_PASADA | Solo lectura |
| Inicio de fecha anterior | PLAN_INICIO_PASADO | Solo lectura |
| HorasPorDia=7, modalidad inexistente o hora fuera de 06–22 | PLAN_ENTRADA_INVALIDA, sin plan parcial | Solo lectura |
| Fin matrícula posterior al fin del curso | COHORTE_FECHAS_INVALIDAS | Solo lectura |
| Entorno UI aislado con date_rules activo para inspección | Tabla de 12 opciones, sesiones, inicio de referencia y fin real; fin de semana/1h no ofertado | Apagar indicador y recargar |
| Todos los indicadores apagados | Tabla oculta; flujo legacy conserva sus valores | Mantener apagados |
| Configuración no consultable en copia local | PLAN_CONFIG_NO_DISPONIBLE y aviso accionable | Restaurar privilegios de copia, nunca alterar reales |

La tabla no calcula duración en el navegador: consume resultados del constructor
común. Su presencia no autoriza reservar; SQL vuelve a validar al implementar 071.
No activar este flujo público antes de desplegar sus dependencias de reservas/pago.
Los calendarios del navegador son orientativos. Las alertas de jobs aún no aplican.

## Riesgos y pendientes

No hay datos reales ni activación. La decisión comercial fin de semana/1h sigue pendiente.
Los errores están en cohortes-errores.md; componente/UI queda en PRUEBAS_PENDIENTES.md.
La continuidad autorizada permite pasar a lote 3 al estar estas pruebas obligatorias verdes.
