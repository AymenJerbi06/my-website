const { queryOne } = require('../db');

module.exports = async function requireAuth(req, res, next) {
  const { userId, sessionToken } = req.session || {};

  if (!userId) {
    return req.path.startsWith('/api')
      ? res.status(401).json({ success: false, message: 'Not authenticated.' })
      : res.redirect('/');
  }

  // Validate that this is still the active session for this account.
  // If the same account logged in elsewhere, their new token replaced this one.
  const user = await queryOne(
    'SELECT active_session_token FROM users WHERE id = $1',
    [userId]
  ).catch(() => null);

  if (!user || user.active_session_token !== sessionToken) {
    req.session.destroy(() => {});
    return req.path.startsWith('/api')
      ? res.status(401).json({
          success: false,
          message: 'Your session has expired because your account was used on another device.',
          kicked: true,
        })
      : res.redirect('/?kicked=1');
  }

  next();
};
