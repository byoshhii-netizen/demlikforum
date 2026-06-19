const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../database');

// Giriş yap
router.post('/giris', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email ve şifre gerekli' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Email veya şifre hatalı' });

    const user = result.rows[0];
    if (user.is_banned) return res.status(403).json({ error: 'Hesabınız askıya alınmıştır: ' + (user.ban_reason || '') });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email veya şifre hatalı' });

    // IP kaydet
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    await pool.query('UPDATE users SET last_ip = $1, updated_at = NOW() WHERE id = $2', [ip, user.id]);

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.email = user.email;

    res.json({ success: true, role: user.role, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Kullanıcı kayıt
router.post('/kayit/kullanici', async (req, res) => {
  const { username, email, password, birth_date, age_confirm, kvkk, sozlesme } = req.body;

  if (!username || !email || !password || !birth_date) {
    return res.status(400).json({ error: 'Tüm alanlar zorunludur' });
  }
  if (!age_confirm) return res.status(400).json({ error: '16 yaş ve üstü olduğunuzu onaylamanız gerekiyor' });
  if (!kvkk) return res.status(400).json({ error: 'KVKK metnini kabul etmeniz gerekiyor' });
  if (!sozlesme) return res.status(400).json({ error: 'Kayıt sözleşmesini kabul etmeniz gerekiyor' });

  // Yaş kontrolü
  const dob = new Date(birth_date);
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (age < 16) return res.status(400).json({ error: '16 yaşından küçükler kayıt olamaz' });

  if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Bu email veya kullanıcı adı zaten kullanılıyor' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, birth_date, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, role',
      [username, email, hash, birth_date, 'user']
    );

    const user = result.rows[0];
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.email = email;

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Geliştirici kayıt başvurusu
router.post('/kayit/gelistirici', async (req, res) => {
  const {
    team_name, first_name, last_name, username, email, password,
    has_previous_games, previous_game_type, previous_game_name, previous_game_description,
    developer_terms, user_terms
  } = req.body;

  if (!team_name || !first_name || !last_name || !username || !email || !password) {
    return res.status(400).json({ error: 'Tüm zorunlu alanları doldurun' });
  }
  if (!developer_terms) return res.status(400).json({ error: 'Geliştirici şartlarını kabul etmeniz gerekiyor' });
  if (!user_terms) return res.status(400).json({ error: 'Kullanıcı şartlarını kabul etmeniz gerekiyor' });

  if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Bu email veya kullanıcı adı zaten kullanılıyor' });

    const hash = await bcrypt.hash(password, 12);

    // Önce normal kullanıcı olarak kayıt (başvuru beklemede)
    const userResult = await pool.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
      [username, email, hash, 'user']
    );

    const user = userResult.rows[0];

    // Başvuru kaydet
    await pool.query(
      `INSERT INTO developer_applications 
       (user_id, team_name, first_name, last_name, username, email, has_previous_games, previous_game_type, previous_game_name, previous_game_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [user.id, team_name, first_name, last_name, username, email,
       has_previous_games || false, previous_game_type || null, previous_game_name || null, previous_game_description || null]
    );

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.email = email;

    res.json({ success: true, pending: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Çıkış
router.post('/cikis', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Geliştirici başvuru durumu kontrol
router.get('/basvuru-durum', async (req, res) => {
  if (!req.session.userId) return res.json({ status: null });
  try {
    const result = await pool.query(
      'SELECT status FROM developer_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.session.userId]
    );
    res.json({ status: result.rows[0]?.status || null });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
