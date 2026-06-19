const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { pool } = require('../database');
const { uploadFile } = require('../r2');
const { requireAuth } = require('../middleware');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Profil görüntüle
router.get('/profil/:username', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, role, show_games, created_at FROM users WHERE username=$1',
      [req.params.username]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const user = result.rows[0];

    let games = [];
    if (user.show_games) {
      const gResult = await pool.query(`
        SELECT g.id, g.title, g.logo_url, ul.is_installed, ul.last_played
        FROM user_library ul JOIN games g ON ul.game_id=g.id
        WHERE ul.user_id=$1 AND g.is_published=true
      `, [user.id]);
      games = gResult.rows;
    }
    res.json({ user, games });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Kendi profilini güncelle
router.put('/profil', requireAuth, upload.single('avatar'), async (req, res) => {
  const { bio, show_games } = req.body;
  try {
    let avatarUrl;
    if (req.file) {
      avatarUrl = await uploadFile(req.file.buffer, req.file.originalname, 'avatars');
    }
    const query = avatarUrl
      ? 'UPDATE users SET bio=$1, show_games=$2, avatar_url=$3, updated_at=NOW() WHERE id=$4'
      : 'UPDATE users SET bio=$1, show_games=$2, updated_at=NOW() WHERE id=$3';
    const params = avatarUrl
      ? [bio, show_games === 'true', avatarUrl, req.session.userId]
      : [bio, show_games === 'true', req.session.userId];
    await pool.query(query, params);
    res.json({ success: true, avatarUrl });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Şifre değiştir
router.post('/sifre-degistir', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Tüm alanlar gerekli' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı' });
  try {
    const user = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.session.userId]);
    const valid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Mevcut şifre yanlış' });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.session.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Engelle
router.post('/engelle/:userId', requireAuth, async (req, res) => {
  try {
    await pool.query('INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.session.userId, req.params.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.delete('/engelle/:userId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM blocked_users WHERE blocker_id=$1 AND blocked_id=$2',
      [req.session.userId, req.params.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.get('/engellilistesi', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.avatar_url, bu.created_at
      FROM blocked_users bu JOIN users u ON bu.blocked_id=u.id
      WHERE bu.blocker_id=$1
    `, [req.session.userId]);
    res.json({ blocked: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Aile denetimi
router.get('/aile-denetimi', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM parental_controls WHERE user_id=$1', [req.session.userId]);
    res.json({ control: result.rows[0] || null });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.post('/aile-denetimi', requireAuth, async (req, res) => {
  const { is_enabled, parent_first_name, parent_last_name, parent_age, child_age, allow_profanity } = req.body;
  if (is_enabled && (!parent_first_name || !parent_last_name || !parent_age || !child_age)) {
    return res.status(400).json({ error: 'Aile denetimi için tüm alanlar gerekli' });
  }
  try {
    await pool.query(`
      INSERT INTO parental_controls (user_id, is_enabled, parent_first_name, parent_last_name, parent_age, child_age, allow_profanity, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (user_id) DO UPDATE SET is_enabled=$2, parent_first_name=$3, parent_last_name=$4, parent_age=$5, child_age=$6, allow_profanity=$7, updated_at=NOW()
    `, [req.session.userId, is_enabled, parent_first_name, parent_last_name, parseInt(parent_age)||0, parseInt(child_age)||0, allow_profanity||false]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Kendi bilgileri
router.get('/ben', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, bio, avatar_url, role, show_games, birth_date, created_at FROM users WHERE id=$1',
      [req.session.userId]
    );
    // Geliştirici durumu
    let devApp = null;
    const app = await pool.query(
      "SELECT status FROM developer_applications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [req.session.userId]
    );
    if (app.rows[0]) devApp = app.rows[0].status;

    res.json({ user: result.rows[0], devApplicationStatus: devApp });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

module.exports = router;
