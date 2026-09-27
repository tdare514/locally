/** Error classes shared across lib and routes. Messages of all three are safe to show to the user.
 * Each sets `name` so handlers can match by name as well as by `instanceof`: in dev, Turbopack
 * can load this module twice (once per import path), which makes `instanceof` fail across the copies. */
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
export class NotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}
export class PublicError extends Error {
  constructor(message: string) { super(message); this.name = "PublicError"; }
}
