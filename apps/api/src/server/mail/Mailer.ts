/** Sends the six-digit sign-in code to a user's email. */
export interface Mailer {
  sendCode(email: string, code: string): Promise<void>;
}
