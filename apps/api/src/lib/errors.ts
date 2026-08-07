import type { ContentfulStatusCode } from "hono/utils/http-status"

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details)

export const unauthorized = (message = "Sign in to continue.") =>
  new ApiError(401, "unauthorized", message)

export const forbidden = (message = "You do not have access to this resource.") =>
  new ApiError(403, "forbidden", message)

export const notFound = (message = "Not found.") => new ApiError(404, "not_found", message)

export const serviceUnavailable = (code: string, message: string) =>
  new ApiError(503, code, message)
