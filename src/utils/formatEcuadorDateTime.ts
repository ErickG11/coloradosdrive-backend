// Un instante ISO se presenta siempre en Ecuador, sin depender de TZ del proceso.
// Las fechas de plan (YYYY-MM-DD) conservan su dia civil en esa misma zona.
export function formatEcuadorDateTime(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00-05:00` : value);
  if (!Number.isFinite(date.getTime())) throw new Error('Fecha inválida para el correo');
  const parts = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }),
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? '';
  const day = `${part('weekday')} ${part('day')} de ${part('month')}`;
  return `${day}${dateOnly ? '' : `, ${part('hour')}:${part('minute')}`} (hora de Ecuador)`;
}
