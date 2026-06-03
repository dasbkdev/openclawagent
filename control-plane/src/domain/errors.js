export class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function notFound(message, details = undefined) {
  return new AppError("NOT_FOUND", message, 404, details);
}

export function forbidden(message, details = undefined) {
  return new AppError("FORBIDDEN", message, 403, details);
}

export function unauthorized(message = "Authentication required", details = undefined) {
  return new AppError("UNAUTHORIZED", message, 401, details);
}

export function validation(message, details = undefined) {
  return new AppError("VALIDATION_ERROR", message, 400, details);
}
