const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { uploadFile } = require('../r2');
const { requireAuth, requireDeveloper } = require('../middleware');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB
});

// Tüm yayınlanmış oyunları listele (store)
router.get('/liste', async (req, res) => {
  const { genre, search, sort = 'yeni', page = 1, limit = 24 } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT g.*, gg.name as genre_name, u.username as developer_name, dp.team_name
    FROM games g
    LEFT JOIN game_genres gg ON g.genre_id = gg.id
    LEFT JOIN users u ON g.developer_id = u.id
    LEFT JOIN developer_profiles dp ON u.id = dp.user_id
    WHERE g.is_published = true AND g.is_hidden = false
  `;
  const params = [];
  let paramIdx = 1;

  if (genre) {
    query += ` AND gg.name = $${paramIdx++}`;
    params.push(genre);
  }
  if (search) {
    query += ` AND (g.title ILIKE $${paramIdx} OR g.description ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  if (sort === 'yeni') query += ' ORDER BY g.created_at DESC';
  else if (sort === 'populer') query += ' ORDER BY g.download_count DESC';
  else if (sort === 'ucretsiz') query += ' AND g.is_free = true ORDER BY g.download_count DESC';

  query += ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(limit, offset);

  try {
    const result = await pool.query(query, params);
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM games g LEFT JOIN game_genres gg ON g.genre_id = gg.id WHERE g.is_published = true AND g.is_hidden = false${genre ? ' AND gg.name = $1' : ''}`,
      genre ? [genre] : []
    );
    res.json({ games: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Oyun detayı
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, gg.name as genre_name, u.username as developer_name, dp.team_name
      FROM games g
      LEFT JOIN game_genres gg ON g.genre_id = gg.id
      LEFT JOIN users u ON g.developer_id = u.id
      LEFT JOIN developer_profiles dp ON u.id = dp.user_id
      WHERE g.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Oyun bulunamadı' });

    const game = result.rows[0];

    // Kullanıcı kütüphanesinde mi?
    let inLibrary = false;
    let isInstalled = false;
    if (req.session.userId) {
      const lib = await pool.query(
        'SELECT is_installed FROM user_library WHERE user_id = $1 AND game_id = $2',
        [req.session.userId, req.params.id]
      );
      inLibrary = lib.rows.length > 0;
      isInstalled = lib.rows[0]?.is_installed || false;
    }

    // Installer URL'i gizle (sadece kütüphanede varsa ver)
    if (!inLibrary) game.installer_url = null;

    res.json({ game, inLibrary, isInstalled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Kütüphaneye ekle
router.post('/:id/ekle', requireAuth, async (req, res) => {
  try {
    const game = await pool.query('SELECT * FROM games WHERE id = $1 AND is_published = true', [req.params.id]);
    if (game.rows.length === 0) return res.status(404).json({ error: 'Oyun bulunamadı' });

    const g = game.rows[0];
    if (g.is_purchase_disabled) return res.status(403).json({ error: 'Bu oyun şu an satın alınamaz' });

    await pool.query(
      'INSERT INTO user_library (user_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.session.userId, req.params.id]
    );

    await pool.query('UPDATE games SET library_count = library_count + 1 WHERE id = $1', [req.params.id]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Oyun indir (installer URL al)
router.post('/:id/indir', requireAuth, async (req, res) => {
  try {
    const lib = await pool.query(
      'SELECT * FROM user_library WHERE user_id = $1 AND game_id = $2',
      [req.session.userId, req.params.id]
    );
    if (lib.rows.length === 0) return res.status(403).json({ error: 'Oyun kütüphanenizde yok' });

    const game = await pool.query('SELECT installer_url, installer_key, title FROM games WHERE id = $1', [req.params.id]);
    if (!game.rows[0]?.installer_url) return res.status(404).json({ error: 'Kurulum dosyası bulunamadı' });

    await pool.query('UPDATE games SET download_count = download_count + 1 WHERE id = $1', [req.params.id]);

    // Kullanıcı aile denetiminde mi? yaş kontrolü
    const parentCtrl = await pool.query(
      'SELECT * FROM parental_controls WHERE user_id = $1 AND is_enabled = true', [req.session.userId]
    );
    if (parentCtrl.rows.length > 0) {
      const ctrl = parentCtrl.rows[0];
      const gameData = await pool.query('SELECT age_rating FROM games WHERE id = $1', [req.params.id]);
      const ageRating = gameData.rows[0]?.age_rating || 0;
      if (ctrl.child_age < ageRating) {
        return res.status(403).json({ error: `Bu oyun ${ageRating}+ yaş içeriği içeriyor` });
      }
    }

    res.json({ 
      url: game.rows[0].installer_url,
      filename: `${game.rows[0].title.replace(/[^a-zA-Z0-9]/g, '_')}_setup.exe`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Yükleme tamamlandı işaretle
router.post('/:id/yuklendi', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE user_library SET is_installed = true, install_date = NOW() WHERE user_id = $1 AND game_id = $2',
      [req.session.userId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Kullanıcı kütüphanesi
router.get('/kutuphane/liste', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.id, g.title, g.logo_url, g.banner_urls, ul.is_installed, ul.last_played, ul.play_time, ul.added_at
      FROM user_library ul
      JOIN games g ON ul.game_id = g.id
      WHERE ul.user_id = $1
      ORDER BY ul.added_at DESC
    `, [req.session.userId]);
    res.json({ games: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Türler
router.get('/meta/turler', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_genres ORDER BY name');
    res.json({ genres: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
