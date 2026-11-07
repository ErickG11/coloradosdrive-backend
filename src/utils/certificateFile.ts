import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { LIMITES_CERTIFICADO } from '../config/enrollmentCatalog';
import { AppError } from './AppError';
import { detectFileType, type DetectedFileType } from './fileSignature';
import { inspectPdf } from './pdfInspection';
import { ProcessingGate } from './processingGate';
import { solicitudError } from './solicitudError';

export interface CertificateInput {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}
export interface PreparedCertificate {
  buffer: Buffer;
  mime: 'image/jpeg' | 'application/pdf';
  extension: 'jpg' | 'pdf';
  size: number;
  sha256: string;
}

const EXTENSIONS: Record<DetectedFileType, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'application/pdf': ['pdf'],
};
const gate = new ProcessingGate(LIMITES_CERTIFICADO.concurrencia, LIMITES_CERTIFICADO.esperaMs);
const invalid = (message: string, code = 'ARCHIVO_INVALIDO'): AppError =>
  solicitudError(message, 400, code);
const tooBig = (): AppError =>
  solicitudError('El archivo supera los 2 MiB permitidos.', 413, 'ARCHIVO_DEMASIADO_GRANDE');

async function reencode(buffer: Buffer): Promise<Buffer> {
  try {
    const image = sharp(buffer, {
      limitInputPixels: LIMITES_CERTIFICADO.pixeles,
      failOn: 'error',
    });
    const meta = await image.metadata();
    if (meta.format !== 'jpeg' && meta.format !== 'png')
      throw invalid('El contenido no coincide con una imagen JPG o PNG.');
    // Recodificar a JPEG descarta EXIF/GPS y cualquier dato añadido al final, y neutraliza
    // políglotas. rotate() aplica la orientación antes de perderla con los metadatos.
    return await image
      .rotate()
      .resize({
        width: LIMITES_CERTIFICADO.lado,
        height: LIMITES_CERTIFICADO.lado,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: LIMITES_CERTIFICADO.calidad })
      .timeout({ seconds: 10 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid('No se pudo leer la imagen. Sube otra foto o un PDF.');
  }
}

// Valida y normaliza el certificado antes de guardarlo. Solo el contenido real manda:
// la firma binaria debe coincidir con el MIME declarado y con la extensión.
export async function prepareCertificate(file: CertificateInput): Promise<PreparedCertificate> {
  if (file.buffer.length === 0) throw invalid('El archivo está vacío.');
  if (file.buffer.length > LIMITES_CERTIFICADO.bytes) throw tooBig();
  const detected = detectFileType(file.buffer);
  if (!detected)
    throw invalid('Solo se admiten archivos JPG, PNG o PDF.', 'ARCHIVO_TIPO_NO_PERMITIDO');
  const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
  if (file.mimetype !== detected || !EXTENSIONS[detected].includes(extension))
    throw invalid('La extensión o el tipo del archivo no coinciden con su contenido.');

  const result = await gate.run(async () => {
    if (detected === 'application/pdf') {
      inspectPdf(file.buffer);
      return { buffer: file.buffer, mime: detected, extension: 'pdf' as const };
    }
    return {
      buffer: await reencode(file.buffer),
      mime: 'image/jpeg' as const,
      extension: 'jpg' as const,
    };
  });
  if (result.buffer.length > LIMITES_CERTIFICADO.bytes) throw tooBig();
  return {
    ...result,
    size: result.buffer.length,
    sha256: createHash('sha256').update(result.buffer).digest('hex'),
  };
}
