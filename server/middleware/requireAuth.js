module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  // API calls get a 401, page requests get redirected
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }
  return res.redirect('/');
};
