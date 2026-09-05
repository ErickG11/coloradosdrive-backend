import { LEVENSHTEIN_THRESHOLD, gradeOpenTextAnswer } from '../../src/services/grading.service';

describe('gradeOpenTextAnswer', () => {
  it('acepta una coincidencia exacta con la respuesta correcta', () => {
    const result = gradeOpenTextAnswer('Cinturón de seguridad', 'cinturon de seguridad', null);

    expect(result.isCorrect).toBe(true);
    expect(result.similarityScore).toBe(1);
  });

  it('acepta un error ortografico leve (una letra) por encima del umbral 0.85', () => {
    // "cinturon de seguridad" (21 caracteres) con 1 sustitucion:
    // ratio = 1 - 1/21 ≈ 0.952
    const result = gradeOpenTextAnswer('cinturon de seguridao', 'cinturon de seguridad', null);

    expect(result.similarityScore).toBeGreaterThanOrEqual(LEVENSHTEIN_THRESHOLD);
    expect(result.isCorrect).toBe(true);
  });

  it('acepta una respuesta que coincide con un sinonimo aunque no coincida con correct_answer_text', () => {
    const result = gradeOpenTextAnswer('cinturon de seguridad', 'seat belt', [
      'cinturon de seguridad',
      'cinturon',
    ]);

    expect(result.isCorrect).toBe(true);
    expect(result.similarityScore).toBe(1);
  });

  it('toma el mejor score entre correct_answer_text y todos los sinonimos', () => {
    const result = gradeOpenTextAnswer('cinturon', 'cinturon de seguridad', ['correa', 'cinturon']);

    expect(result.similarityScore).toBe(1);
    expect(result.isCorrect).toBe(true);
  });

  it('rechaza una respuesta claramente incorrecta', () => {
    const result = gradeOpenTextAnswer('volante', 'cinturon de seguridad', ['cinturon']);

    expect(result.similarityScore).toBeLessThan(LEVENSHTEIN_THRESHOLD);
    expect(result.isCorrect).toBe(false);
  });

  it('rechaza una respuesta vacia contra una respuesta correcta no vacia', () => {
    const result = gradeOpenTextAnswer('', 'cinturon de seguridad', null);

    expect(result.isCorrect).toBe(false);
  });

  it('ignora mayusculas/minusculas, tildes y puntuacion al comparar', () => {
    const result = gradeOpenTextAnswer('¡CINTURÓN, de SEGURIDAD!', 'cinturon de seguridad', null);

    expect(result.similarityScore).toBe(1);
    expect(result.isCorrect).toBe(true);
  });

  it('ignora espacios extra al inicio, al final y entre palabras', () => {
    const result = gradeOpenTextAnswer(
      '  cinturon   de  seguridad  ',
      'cinturon de seguridad',
      null,
    );

    expect(result.similarityScore).toBe(1);
    expect(result.isCorrect).toBe(true);
  });

  describe('casos limite cerca del umbral 0.85', () => {
    it('justo por debajo del umbral (0.84) se marca incorrecta', () => {
      // "abcdefghijklmnopqrst" (20 caracteres) con 4 sustituciones:
      // ratio = 1 - 4/20 = 0.80 (< 0.85)
      const result = gradeOpenTextAnswer('wxyzefghijklmnopqrst', 'abcdefghijklmnopqrst', null);

      expect(result.similarityScore).toBeLessThan(LEVENSHTEIN_THRESHOLD);
      expect(result.isCorrect).toBe(false);
    });

    it('justo en el umbral (exactamente 0.85) se marca correcta (umbral inclusivo)', () => {
      // "abcdefghijklmnopqrst" (20 caracteres) con 3 sustituciones:
      // ratio = 1 - 3/20 = 0.85 (== umbral, inclusivo)
      const result = gradeOpenTextAnswer('wxydefghijklmnopqrst', 'abcdefghijklmnopqrst', null);

      expect(result.similarityScore).toBeCloseTo(0.85, 10);
      expect(result.isCorrect).toBe(true);
    });

    it('justo por encima del umbral (0.90) se marca correcta', () => {
      // "abcdefghijklmnopqrst" (20 caracteres) con 2 sustituciones:
      // ratio = 1 - 2/20 = 0.90 (> 0.85)
      const result = gradeOpenTextAnswer('wxcdefghijklmnopqrst', 'abcdefghijklmnopqrst', null);

      expect(result.similarityScore).toBeCloseTo(0.9, 10);
      expect(result.isCorrect).toBe(true);
    });
  });
});
