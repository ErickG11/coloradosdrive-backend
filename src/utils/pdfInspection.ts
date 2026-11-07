import { inflateSync } from 'node:zlib';
import { LIMITES_CERTIFICADO } from '../config/enrollmentCatalog';
import type { AppError } from './AppError';
import { solicitudError } from './solicitudError';

// Inspección estática y conservadora de PDF. No interpreta el documento: rechaza lo que
// podría ejecutar acciones o que no puede inspeccionarse (falla cerrado). El PDF aceptado
// se guarda tal cual, en bucket privado y solo se entrega como descarga.
const MAX_DECODED_BYTES = 8 * 1024 * 1024;
const FORBIDDEN = [
  'JavaScript',
  'JS',
  'OpenAction',
  'AA',
  'Launch',
  'EmbeddedFile',
  'EmbeddedFiles',
  'RichMedia',
  'XFA',
  'SubmitForm',
  'GoToR',
  'GoToE',
  'ImportData',
];
const NAME_END = String.raw`(?![^\s/<>\[\]()%{}])`;
const FORBIDDEN_RE = new RegExp(`/(?:${FORBIDDEN.join('|')})${NAME_END}`);
const PAGE_RE = new RegExp(String.raw`/Type\s*/Page${NAME_END}`, 'g');

const invalid = (message = 'El PDF no es válido o no se pudo revisar.'): AppError =>
  solicitudError(message, 400, 'ARCHIVO_INVALIDO');

// Los nombres PDF admiten #XX: /J#61vaScript es /JavaScript. Se decodifican antes de buscar.
function decodeNames(text: string): string {
  return text.replace(/\/[^\s/<>[\]()%{}]*/g, (name) =>
    name.replace(/#([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
  );
}

export function inspectPdf(buffer: Buffer): { paginas: number } {
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw invalid();
  if (
    !buffer
      .subarray(Math.max(0, buffer.length - 1024))
      .toString('latin1')
      .includes('%%EOF')
  )
    throw invalid();

  const text = buffer.toString('latin1');
  const scanned: string[] = [];
  let cursor = 0;
  let decoded = 0;
  const streamStart = /(?<!end)stream(?:\r\n|\n|\r)/g;
  let match: RegExpExecArray | null;
  while ((match = streamStart.exec(text))) {
    const bodyStart = match.index + match[0].length;
    const end = text.indexOf('endstream', bodyStart);
    if (end < 0) throw invalid();
    // Se conserva el diccionario (queda antes de "stream") y se descarta el cuerpo binario,
    // que podría contener nombres por casualidad y no ejecuta acciones por sí mismo.
    const before = text.slice(cursor, match.index);
    scanned.push(before);
    const dict = decodeNames(before.slice(before.lastIndexOf('obj') + 3));
    if (/\/Type\s*\/ObjStm/.test(dict)) {
      // Los objetos comprimidos pueden esconder acciones: solo se aceptan si se pueden inflar.
      const filters = /\/Filter\s*(\[[^\]]*\]|\/[^\s/<>[\]()%{}]+)/.exec(dict)?.[1] ?? '';
      if (!/^\s*(\[\s*\/FlateDecode\s*\]|\/FlateDecode)\s*$/.test(filters)) throw invalid();
      let inflated: Buffer;
      try {
        inflated = inflateSync(Buffer.from(text.slice(bodyStart, end), 'latin1'), {
          maxOutputLength: MAX_DECODED_BYTES - decoded,
        });
      } catch {
        throw invalid();
      }
      decoded += inflated.length;
      scanned.push(inflated.toString('latin1'));
    }
    cursor = end + 'endstream'.length;
    streamStart.lastIndex = cursor;
  }
  scanned.push(text.slice(cursor));

  const normalized = decodeNames(scanned.join('\n'));
  if (/\/Encrypt(?![^\s/<>[\]()%{}])/.test(normalized)) throw invalid();
  if (FORBIDDEN_RE.test(normalized))
    throw invalid(
      'El PDF contiene elementos activos y no se admite. Sube una foto o un PDF simple.',
    );
  const paginas = (normalized.match(PAGE_RE) ?? []).length;
  if (paginas < 1 || paginas > LIMITES_CERTIFICADO.paginas)
    throw invalid(`El PDF debe tener entre 1 y ${String(LIMITES_CERTIFICADO.paginas)} páginas.`);
  return { paginas };
}
