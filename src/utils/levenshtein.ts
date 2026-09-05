// Normaliza una cadena para comparacion de texto abierto (RF-02):
// minusculas, sin espacios en los extremos, sin tildes/acentos y sin
// puntuacion. Dos respuestas que solo difieren en estos aspectos deben
// considerarse identicas antes de calcular la distancia de Levenshtein.
//
// NFD descompone cada letra acentuada en base + marca diacritica
// combinante (ej. "e" + U+0301 para "é"); el rango ̀-ͯ cubre
// todas las marcas diacriticas combinantes de Unicode, así que quitarlas
// deja solo la letra base.
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

// Distancia de edicion clasica (Levenshtein) entre dos cadenas: numero
// minimo de inserciones, eliminaciones o sustituciones de un caracter
// para transformar `a` en `b`.
export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    distances[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    distances[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + substitutionCost,
      );
    }
  }

  return distances[rows - 1][cols - 1];
}

// Ratio de similitud normalizado: 1 - distancia / max(len_a, len_b), en
// [0, 1]. Dos cadenas vacias se consideran identicas (ratio 1).
export function similarityRatio(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(a, b) / maxLength;
}
