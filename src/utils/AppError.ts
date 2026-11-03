export class AppError extends Error {
  public readonly statusCode: number;

  public readonly isOperational: boolean;

  public readonly code?: string;
  public readonly field?: string;
  public readonly detalles?: Record<string, unknown>;

  constructor(message: string, statusCode: number, metadata?: { code: string; field?: string; detalles?: Record<string, unknown> }) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = metadata?.code;
    this.field = metadata?.field;
    this.detalles = metadata?.detalles;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
