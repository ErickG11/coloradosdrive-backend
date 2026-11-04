// Búsqueda segura en filtros PostgREST (.or / .ilike). El texto del usuario
// nunca se concatena crudo: se normaliza, se escapan los comodines de LIKE
// (%, _, \) y se entrecomilla para que comas, paréntesis, puntos y dos puntos
// no puedan introducir operadores o condiciones nuevas en .or().

const MAX_SEARCH_LENGTH = 80;
// Se eliminan precisamente los caracteres de control.
const HIDDEN_CHARACTERS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]',
  'g',
);

export function sanitizeSearchTerm(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return (
    raw
      .normalize('NFC')
      // Controles, ancho cero y anulación bidireccional.
      .replace(HIDDEN_CHARACTERS, '')
      // PostgREST traduce "*" a "%" en like/ilike: no puede escaparse, se descarta.
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_SEARCH_LENGTH)
  );
}

// Patrón "contiene" ya entrecomillado para usarse como valor en .or(...).
export function containsPattern(raw: unknown): string | null {
  const term = sanitizeSearchTerm(raw);
  if (!term) return null;
  const likeEscaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  const quoted = likeEscaped.replace(/[\\"]/g, (char) => `\\${char}`);
  return `"%${quoted}%"`;
}

// Arma "col1.ilike.<patrón>,col2.ilike.<patrón>"; null si no hay término.
export function buildIlikeOr(columns: readonly string[], raw: unknown): string | null {
  const pattern = containsPattern(raw);
  return pattern ? columns.map((column) => `${column}.ilike.${pattern}`).join(',') : null;
}
