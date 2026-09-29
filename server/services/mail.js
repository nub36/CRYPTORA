/**
 * CRYPTORA — Mail Service facade.
 *
 * The implementation lives in ./mail/ (transport in ./mail/index.js, message
 * content in ./mail/templates.js). This module re-exports the public surface
 * so every existing `import ... from '../services/mail.js'` keeps working.
 */

export {
  MailUnavailableError,
  getMailFrom,
  getMailStatus,
  getTransport,
  getTransportKind,
  sendMail,
  maskEmail,
  sendVerificationCodeEmail,
  __setTransportForTests,
  __resetTransportForTests,
} from './mail/index.js';
