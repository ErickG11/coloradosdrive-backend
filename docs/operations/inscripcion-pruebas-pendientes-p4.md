# Pruebas pendientes P4

## F34
- Pestañas: Pendientes por defecto; estado correcto por pestaña; flechas/Inicio/Fin.
- Busqueda envia q recortado y reinicia pagina; Quitar busqueda.
- Insignia Mas de 48 h solo en enviada con enviadaAt > 48 h.
- Interruptor: confirmacion antes de PUT, cancelar no llama, error visible, foco vuelve al interruptor.
- Medidores: alerta >=80 %, role meter.
- Contador del menu: oculto en 0, 99+, aria-label; aviso solo cuando sube; refresco 30 s visible, foco, tras decision.
- Reescribir tests/components/solicitudes-admin/* (contrato viejo).

## F35
- Abrir portal: _blank con rel noopener noreferrer; Copiar cedula (exito y fallo).
- Metodos segun tipo y nivel; revision_visual rotulado como no habilita.
- Registrar: valida metodo/resultado, nota <=1000, historial con quien y cuando; solo en enviada.
- Certificado: Ver pide URL bajo demanda, expira a 300 s, sin certificado no hay boton, mensaje por cupo.
- Consentimiento: versiones, fecha, representante.

## F36
- Aprobar/rechazar piden confirmacion; devolver directo. Mensaje solo con OTRO (10-300); nota <=1000.
- Resultado: cohorte asignada/pendiente, correo enviado/no/sin correo, reenviar enlace (exito, fallo, error).
- No enviada: solo lectura con motivo y nota interna. 409 recarga detalle. Foco al resultado tras decidir.
