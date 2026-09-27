import type { Mailer } from "./Mailer";

/**
 * Development `Mailer`: prints the code to the server log instead of sending
 * an email, so `npm run dev` needs no mail provider account. The smoke test
 * and local testing both read the code straight out of this log line.
 */
export class ConsoleMailer implements Mailer {
  async sendCode(email: string, code: string): Promise<void> {
    console.log(`[sync-api] sign-in code for ${email}: ${code}`);
  }
}
