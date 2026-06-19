const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { uploadFile, deleteFile } = require('../r2');
const { requireAdmin } = require('../middleware');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 * 1024 } });

// ======= GELİŞTİRİCİ BAŞVURULARI =======
router.get('/basvurular', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT da.*, u.username, u.email as user_email, u.last_ip, u.last_location
      FROM developer_applications da
      JOIN users u ON da.user_id = u.id
      ORDER BY da.created_at DESC
    `);
    res.json({ applications: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.post('/basvurular/:id/kabul', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const app = await client.query('SELECT * FROM developer_applications WHERE id = $1', [req.params.id]);
    if (!app.rows[0]) return res.status(404).json({ error: 'Başvuru bulunamadı' });
    const a = app.rows[0];

    await client.query('UPDATE developer_applications SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3',
      ['approved', req.session.userId, req.params.id]);
    await client.query('UPDATE users SET role=$1 WHERE id=$2', ['developer', a.user_id]);

    const existing = await client.query('SELECT id FROM developer_profiles WHERE user_id=$1', [a.user_id]);
    if (existing.rows.length === 0) {
      await client.query(
        'INSERT INTO developer_profiles (user_id, team_name, first_name, last_name) VALUES ($1,$2,$3,$4)',
        [a.user_id, a.team_name, a.first_name, a.last_name]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Sunucu hatası' });
  } finally { client.release(); }
});

router.post('/basvurular/:id/red', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  try {
    await pool.query('UPDATE developer_applications SET status=$1, rejection_reason=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$4',
      ['rejected', reason || '', req.session.userId, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// ======= OYUNLAR =======
router.get('/oyunlar', requireAdmin, async (req, res) => {
  const { search, tип, page = 1, limit = 30 } = req.query;
  const offset = (page - 1) * limit;
  let query = `
    SELECT g.*, gg.name as genre_name, u.username as dev_username, dp.team_name
    FROM games g
    LEFT JOIN game_genres gg ON g.genre_id = gg.id
    LEFT JOIN users u ON g.developer_id = u.id
    LEFT JOIN developer_profiles dp ON u.id = dp.user_id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;
  if (search) { query += ` AND (g.title ILIKE $${idx} OR u.username ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
  if (req.query.tip === 'ucretli') { query += ` AND g.is_free = false`; }
  else if (req.query.tip === 'ucretsiz') { query += ` AND g.is_free = true`; }
  query += ` ORDER BY g.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);
  try {
    const result = await pool.query(query, params);
    res.json({ games: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.get('/oyunlar/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, gg.name as genre_name, u.username as dev_username, dp.team_name
      FROM games g
      LEFT JOIN game_genres gg ON g.genre_id = gg.id
      LEFT JOIN users u ON g.developer_id = u.id
      LEFT JOIN developer_profiles dp ON u.id = dp.user_id
      WHERE g.id = $1
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Oyun bulunamadı' });
    res.json({ game: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.put('/oyunlar/:id', requireAdmin, async (req, res) => {
  const { title, description, publisher_name, age_rating, price, genre_id, is_hidden, is_purchase_disabled, is_free } = req.body;
  try {
    await pool.query(
      `UPDATE games SET title=$1, description=$2, publisher_name=$3, age_rating=$4, price=$5, genre_id=$6,
       is_hidden=$7, is_purchase_disabled=$8, is_free=$9, updated_at=NOW() WHERE id=$10`,
      [title, description, publisher_name, parseInt(age_rating)||0, parseFloat(price)||0,
       genre_id||null, is_hidden||false, is_purchase_disabled||false, is_free||false, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.post('/oyunlar/:id/installer', requireAdmin, upload.single('installer'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi' });
    const url = await uploadFile(req.file.buffer, req.file.originalname, 'installers');
    await pool.query('UPDATE games SET installer_url=$1, upload_status=$2 WHERE id=$3', [url, 'ready', req.params.id]);
    res.json({ success: true, url });
  } catch (err) { res.status(500).json({ error: 'Yükleme hatası' }); }
});

router.delete('/oyunlar/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM games WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// ======= KULLANICILAR =======
router.get('/kullanicilar', requireAdmin, async (req, res) => {
  const { search, role, page = 1, limit = 30 } = req.query;
  const offset = (page - 1) * limit;
  let query = `SELECT u.*, dp.team_name, dp.developer_score FROM users u LEFT JOIN developer_profiles dp ON u.id=dp.user_id WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (search) { query += ` AND (u.username ILIKE $${idx} OR u.email ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
  if (role) { query += ` AND u.role=$${idx++}`; params.push(role); }
  query += ` ORDER BY u.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);
  try {
    const result = await pool.query(query, params);
    const countR = await pool.query('SELECT COUNT(*) FROM users');
    res.json({ users: result.rows, total: parseInt(countR.rows[0].count) });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.get('/kullanicilar/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT u.*, dp.team_name, dp.developer_score, dp.payment_unlocked FROM users u LEFT JOIN developer_profiles dp ON u.id=dp.user_id WHERE u.id=$1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.post('/kullanicilar/:id/engelle', requireAdmin, async (req, res) => {
  const { action, reason } = req.body;
  try {
    if (action === 'ban') {
      await pool.query('UPDATE users SET is_banned=true, ban_reason=$1 WHERE id=$2', [reason||'', req.params.id]);
    } else if (action === 'unban') {
      await pool.query('UPDATE users SET is_banned=false, ban_reason=null WHERE id=$1', [req.params.id]);
    } else if (action === 'message_block') {
      await pool.query('UPDATE users SET message_blocked=true WHERE id=$1', [req.params.id]);
    } else if (action === 'message_unblock') {
      await pool.query('UPDATE users SET message_blocked=false WHERE id=$1', [req.params.id]);
    } else if (action === 'friend_block') {
      await pool.query('UPDATE users SET friend_blocked=true WHERE id=$1', [req.params.id]);
    } else if (action === 'friend_unblock') {
      await pool.query('UPDATE users SET friend_blocked=false WHERE id=$1', [req.params.id]);
    } else if (action === 'game_upload_block') {
      await pool.query('UPDATE users SET game_upload_blocked=true WHERE id=$1', [req.params.id]);
    } else if (action === 'game_upload_unblock') {
      await pool.query('UPDATE users SET game_upload_blocked=false WHERE id=$1', [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Geliştirici ücret kilidini aç
router.post('/kullanicilar/:id/ucret-kilidi', requireAdmin, async (req, res) => {
  const { unlock } = req.body;
  try {
    await pool.query('UPDATE developer_profiles SET payment_unlocked=$1 WHERE user_id=$2', [unlock, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Kullanıcı profilini admin olarak düzenle
router.put('/kullanicilar/:id', requireAdmin, async (req, res) => {
  const { username, email, role, bio } = req.body;
  try {
    await pool.query('UPDATE users SET username=$1, email=$2, role=$3, bio=$4, updated_at=NOW() WHERE id=$5',
      [username, email, role, bio, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// ======= PLATFORM AYARLARI =======
router.get('/ayarlar', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM platform_settings');
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json({ settings });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.put('/ayarlar', requireAdmin, async (req, res) => {
  const { key, value } = req.body;
  try {
    await pool.query('INSERT INTO platform_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
      [key, value]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// ======= OYUN TÜRLERİ =======
router.get('/turler', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_genres ORDER BY name');
    res.json({ genres: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.post('/turler', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Tür adı gerekli' });
  try {
    await pool.query('INSERT INTO game_genres (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

router.delete('/turler/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM game_genres WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// İstatistikler
router.get('/istatistikler', requireAdmin, async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const games = await pool.query('SELECT COUNT(*) FROM games WHERE is_published=true');
    const devApps = await pool.query("SELECT COUNT(*) FROM developer_applications WHERE status='pending'");
    const downloads = await pool.query('SELECT SUM(download_count) FROM games');
    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalGames: parseInt(games.rows[0].count),
      pendingApplications: parseInt(devApps.rows[0].count),
      totalDownloads: parseInt(downloads.rows[0].sum) || 0
    });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

module.exports = router;
