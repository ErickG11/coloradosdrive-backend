// Detecta el tipo real de un archivo por su firma binaria ("magic
// numbers"), no por el Content-Type que declara el cliente (falsificable
// con solo cambiar la extensión/el header del formulario). Implementado a
// mano en vez de una librería porque el conjunto a cubrir es fijo y
// pequeño (los 3 tipos que este proyecto acepta); evita además pelear con
// el interop ESM/CommonJS que ya documenta config/jwks.ts para paquetes
// solo-ESM en este backend (Node 18, CommonJS).

export type DetectedFileType = 'image/jpeg' | 'image/png' | 'application/pdf';

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => buffer[index] === byte);
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// "%PDF-"
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * Devuelve el tipo real del archivo según su contenido, o null si no
 * coincide con ninguno de los 3 tipos permitidos (JPG, PNG, PDF).
 */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (startsWith(buffer, JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (startsWith(buffer, PDF_SIGNATURE)) {
    return 'application/pdf';
  }
  return null;
}
