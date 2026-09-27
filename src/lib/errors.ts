/** Error classes shared across lib and routes. Messages of all three are safe to show to the user. */
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class PublicError extends Error {}
