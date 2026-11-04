# ADR 015 — Verificación en la fuente (inscripción en línea)

Estado: aceptado. Sustituye la decisión de ADR 014 de "no consultar Registro Civil ni Ministerio" y de subir cuatro documentos digitales.

## Contexto

La inscripción pública pedía cédula, papeleta de votación, tipo de sangre y título como archivos. Cada archivo es superficie de ataque (formatos hostiles, metadatos, almacenamiento de datos sensibles) y obliga a retener datos que la escuela puede comprobar directamente.

## Decisión

"Lo que se puede verificar en la fuente, no se sube. Lo que no, se verifica en persona o por llamada."

- Identidad: el administrador consulta el Registro Civil por número de cédula (método `registro_civil_portal`; `registro_civil_web_service` queda previsto en el catálogo y no se usa).
- Estudios: el administrador consulta el Ministerio de Educación por cédula (`ministerio_portal`) para los niveles bachiller*. Para décimo aprobado y cursando bachillerato solo valen `codigo_qr_certificado`, `llamada_institucion` u `original_presencial`.
- Se sube como máximo UN archivo (`certificado_estudios`) y solo si el nivel declarado lo exige. Cédula, papeleta, carné de sangre y original del certificado son documentos físicos que el alumno lleva a la escuela; el instructor cota la cédula original en la primera clase.
- Las verificaciones son un registro append-only (tipo, método, resultado, nota, quién, cuándo). `revision_visual` nunca habilita aprobar. Aprobar exige identidad y estudios en `verificado` con un método válido.
- Las notas de verificación son técnicas: sin nombres, cédulas, correos ni transcripciones de documentos.

## Consecuencias

- Menos datos personales almacenados y un pipeline de archivos mucho más pequeño.
- La verificación depende de portales externos sin API estable; si caen, la solicitud espera o se devuelve. No hay verificación automática ni OCR.
- El certificado verificado se borra a los 30 días; queda el registro de quién, cómo y cuándo.
