export class AppError extends Error {
  public readonly statusCode: number;

  public readonly isOperational: boolean;

  public readonly code?: string;
  public readonly field?: string;

  constructor(message: string, statusCode: number, metadata?: { code: string; field?: string }) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = metadata?.code;
    this.field = metadata?.field;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
