# ADR 022: plan de prácticas de diez horas

Fecha de decisión: 12/11/2026. Estado: aprobado por el dueño. Cambio C08.

Los planes nuevos de los cursos A (motocicletas) y B (vehículos livianos) tienen diez horas de práctica. Entre semana se ofrecen una hora diaria durante diez días hábiles consecutivos o dos horas diarias durante cinco días hábiles consecutivos. Fin de semana se ofrecen dos horas diarias durante cinco días consecutivos de sábado y domingo desde el inicio, repartidos en tres fines de semana. Las opciones de tres a seis horas diarias y la de una hora en fin de semana quedan deshabilitadas; las doce filas se conservan.

`enrollment_plan_options` es la fuente del objetivo y de las combinaciones habilitadas. Su objetivo es positivo, no nulo y tiene valor predeterminado diez. `courses.horas_requeridas=10` para A y B expresa el requisito de certificación RF-07 para los nuevos planes. Las matrículas anteriores conservan su objetivo individual de quince horas, sus fechas y sus prácticas. La migración no actualiza matrículas, reservas, pagos ni prácticas existentes.

La confirmación de pago comprueba el objetivo individual fijado al reservar, de modo que una reserva antigua de quince horas sigue siendo válida. Las propuestas de cambio guardan su objetivo nuevo en la instantánea de la reserva; solo una confirmación explícita sustituye el plan y su objetivo individual. Las propuestas anteriores sin ese campo conservan el objetivo de la matrícula original.

El alumno elige modalidad, horas diarias cuando hay opciones, fecha y hora de inicio. El servidor construye todos los días consecutivos de la modalidad. El selector compartido pinta exclusivamente las fechas devueltas por el servidor; no calcula días de práctica en el navegador. Los rangos tienen la misma hora inicial cada día y terminan dentro de `app_settings.practicas_hora_fin`, con inicio mínimo 06:00. El precio se fija al reservar. Se mantienen los cupos, la reserva de quince minutos y el flujo de pago.

Despliegue manual después de 085: `inscripcion-086-preflight.sql`, `086_plan_diez_horas.sql`, `inscripcion-086-verificacion.sql` (finaliza con ROLLBACK). El preflight registra la restricción, el valor predeterminado, la oferta y los objetivos existentes. Las guardas MD5 detienen la transacción ante cuerpos distintos. El rollback restaura funciones, las doce opciones con sus motivos originales, cursos, restricción y valor predeterminado; requiere coordinar la reversión del API y del frontend y revisar las reservas nuevas antes de volver al código anterior.
