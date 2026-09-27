import { Resend } from "resend";
import type { Mailer } from "./Mailer";

/** Production `Mailer`: sends the code through Resend (`RESEND_API_KEY`, `MAIL_FROM`). */
export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string
  ) {
    this.client = new Resend(apiKey);
  }

  async sendCode(email: string, code: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject: `Your sign-in code: ${code}`,
      text: `Your sign-in code is ${code}. It expires in 10 minutes.`,
    });
    if (error) {
      throw new Error(`Resend failed to send sign-in code: ${error.message}`);
    }
  }
}
