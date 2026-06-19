function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin yetkisi gerekiyor' });
  }
  next();
}

function requireDeveloper(req, res, next) {
  if (!req.session.userId || (req.session.role !== 'developer' && req.session.role !== 'admin')) {
    return res.status(403).json({ error: 'Geliştirici yetkisi gerekiyor' });
  }
  next();
}

function requireAuthPage(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/giris');
  }
  next();
}

function requireAdminPage(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.redirect('/giris');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireDeveloper, requireAuthPage, requireAdminPage };
