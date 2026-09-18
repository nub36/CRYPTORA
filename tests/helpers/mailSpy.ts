/**
 * CRYPTORA — Mail spy for the integration suite.
 *
 * Injects a mock nodemailer transport so tests can assert what the real mail
 * service produced WITHOUT sending anything over the network.
 *
 * The raw verification token is only ever obtainable from the rendered
 * message, so this spy is also how tests recover it to exercise the real
 * /api/auth/verify-email endpoint.
 */

export interface CapturedMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailSpy {
  sent: CapturedMail[];
  last: () => CapturedMail | undefined;
  /** Extract `token=` from the verification link of the last message. */
  lastRawToken: () => string | undefined;
  /** Extract the verification link of the last message. */
  lastLink: () => string | undefined;
  reset: () => void;
}

const TOKEN_RE = /[?&]token=([A-Za-z0-9_-]+)/;
const LINK_RE = /https?:\/\/\S*\/verify-email\?token=[A-Za-z0-9_-]+/;

export function createMailSpy(): MailSpy {
  const sent: CapturedMail[] = [];
  const last = () => sent[sent.length - 1];

  return {
    sent,
    last,
    lastRawToken: () => {
      const m = last()?.text?.match(TOKEN_RE);
      return m ? m[1] : undefined;
    },
    lastLink: () => {
      const m = last()?.text?.match(LINK_RE);
      return m ? m[0] : undefined;
    },
    reset: () => {
      sent.length = 0;
    },
  };
}

/** Build a transport stub that records messages instead of sending them. */
export function spyTransport(spy: MailSpy): { sendMail: (m: CapturedMail) => Promise<{ messageId: string }> } {
  return {
    sendMail: async (m: CapturedMail) => {
      spy.sent.push(m);
      return { messageId: `mock-${spy.sent.length}@cryptora.test` };
    },
  };
}

/**
 * Install the spy on the real mail service and return it.
 * Call `__resetTransportForTests()` in teardown.
 */
export async function installMailSpy(): Promise<MailSpy> {
  const spy = createMailSpy();
  const { __setTransportForTests } = await import('../../server/services/mail.js');
  __setTransportForTests(spyTransport(spy), 'mock');
  return spy;
}
