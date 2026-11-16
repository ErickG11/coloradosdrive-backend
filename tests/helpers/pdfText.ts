import { inflateSync } from 'zlib';

// Lectura mínima de un PDF generado por PDFKit con fuentes estándar: descomprime
// los flujos de contenido y reúne el texto de los operadores TJ (cadenas
// hexadecimales en WinAnsi). Suficiente para comprobar cifras y textos en pruebas.
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}

export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  const stream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = stream.exec(raw); match; match = stream.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      continue; // No es un flujo de contenido comprimido (p. ej. metadatos).
    }
    const line = /\[((?:<[0-9a-fA-F]*>|[^\]])*)\]\s*TJ/g;
    for (let text = line.exec(content); text; text = line.exec(content)) {
      const hex = (text[1].match(/<([0-9a-fA-F]*)>/g) ?? []).map((item) => item.slice(1, -1));
      parts.push(Buffer.from(hex.join(''), 'hex').toString('latin1'));
    }
  }
  return parts.join('\n');
}
