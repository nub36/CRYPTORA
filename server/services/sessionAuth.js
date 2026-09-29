/**
 * CRYPTORA — Session establishment helper
 *
 * SESSION FIXATION: the session ID is REGENERATED on every successful
 * interactive authentication (password login and every OAuth/Telegram
 * sign-in), so an ID planted before authentication can never become an
 * authenticated session.
 *
 * Both the password flow and the social flows share this single mechanism —
 * there is deliberately no parallel JWT system.
 */

/**
 * @param {import('express').Request} req
 * @param {{ id: string, role: string }} user
 */
export async function establishSession(req, user) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });

  req.session.userId = user.id;
  req.session.role = user.role;
  // Freshness stamp for sensitive operations (see requireFreshAuth).
  req.session.authAt = Date.now();

  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}
