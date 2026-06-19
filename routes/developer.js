const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { uploadFile } = require('../r2');
const { requireAuth, requireDeveloper } = require('../middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }
});

// Geliştirici dashboard
router.get('/dashboard', requireDeveloper, async (req, res) => {
  try {
    const games = await pool.query(`
      SELECT g.*, gg.name as genre_name,
        (SELECT COUNT(*) FROM user_library ul WHERE ul.game_id = g.id) as library_count_real
      FROM games g
      LEFT JOIN game_genres gg ON g.genre_id = gg.id
      WHERE g.developer_id = $1
      ORDER BY g.created_at DESC
    `, [req.session.userId]);

    const profile = await pool.query(
      'SELECT * FROM developer_profiles WHERE user_id = $1', [req.session.userId]
    );

    const totalDownloads = games.rows.reduce((sum, g) => sum + (g.download_count || 0), 0);
    const totalLibrary = games.rows.reduce((sum, g) => sum + (parseInt(g.library_count_real) || 0), 0);

    res.json({
      games: games.rows,
      profile: profile.rows[0] || {},
      stats: {
        totalGames: games.rows.length,
        totalDownloads,
        totalLibrary,
        developerScore: profile.rows[0]?.developer_score || 0
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Oyun yükle - metadata
router.post('/oyun/yeni', requireDeveloper, async (req, res) => {
  const {
    title, description, genre_id, age_rating, price,
    publisher_name
  } = req.body;

  if (!title || !description) return res.status(400).json({ error: 'Oyun adı ve açıklaması zorunlu' });

  try {
    // Ücret kontrolü - ilk 500 indirmeye kadar ücretsiz olmalı
    const profile = await pool.query('SELECT payment_unlocked FROM developer_profiles WHERE user_id = $1', [req.session.userId]);
    const paymentUnlocked = profile.rows[0]?.payment_unlocked || false;

    const finalPrice = paymentUnlocked ? (parseFloat(price) || 0) : 0;
    const isFree = finalPrice === 0;

    const devProfile = await pool.query('SELECT team_name FROM developer_profiles WHERE user_id = $1', [req.session.userId]);
    const teamName = devProfile.rows[0]?.team_name || '';

    const result = await pool.query(
      `INSERT INTO games (developer_id, title, description, genre_id, age_rating, price, is_free, publisher_name, upload_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploading')
       RETURNING id`,
      [req.session.userId, title, description, genre_id || null, parseInt(age_rating) || 0,
       finalPrice, isFree, publisher_name || teamName]
    );

    res.json({ success: true, gameId: result.rows[0].id, paymentUnlocked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Logo yükle
router.post('/oyun/:id/logo', requireDeveloper, upload.single('logo'), async (req, res) => {
  try {
    const game = await pool.query('SELECT developer_id FROM games WHERE id = $1', [req.params.id]);
    if (!game.rows[0] || game.rows[0].developer_id !== req.session.userId) {
      return res.status(403).json({ error: 'Yetkisiz' });
    }
    if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    const url = await uploadFile(req.file.buffer, req.file.originalname, 'logos');
    await pool.query('UPDATE games SET logo_url = $1 WHERE id = $2', [url, req.params.id]);
    res.json({ success: true, url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Yükleme hatası' });
  }
});

// Banner yükle
router.post('/oyun/:id/banner', requireDeveloper, upload.single('banner'), async (req, res) => {
  try {
    const game = await pool.query('SELECT developer_id, banner_urls FROM games WHERE id = $1', [req.params.id]);
    if (!game.rows[0] || game.rows[0].developer_id !== req.session.userId) {
      return res.status(403).json({ error: 'Yetkisiz' });
    }
    if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    const url = await uploadFile(req.file.buffer, req.file.originalname, 'banners');
    const currentBanners = game.rows[0].banner_urls || [];
    await pool.query('UPDATE games SET banner_urls = $1 WHERE id = $2', [[...currentBanners, url], req.params.id]);
    res.json({ success: true, url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Yükleme hatası' });
  }
});

// Video yükle
router.post('/oyun/:id/video', requireDeveloper, upload.single('video'), async (req, res) => {
  try {
    const game = await pool.query('SELECT developer_id, video_urls FROM games WHERE id = $1', [req.params.id]);
    if (!game.rows[0] || game.rows[0].developer_id !== req.session.userId) {
      return res.status(403).json({ error: 'Yetkisiz' });
    }
    if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    const url = await uploadFile(req.file.buffer, req.file.originalname, 'videos');
    const currentVideos = game.rows[0].video_urls || [];
    await pool.query('UPDATE games SET video_urls = $1 WHERE id = $2', [[...currentVideos, url], req.params.id]);
    res.json({ success: true, url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Yükleme hatası' });
  }
});

// EXE yükle (büyük dosya - chunk upload)
router.post('/oyun/:id/installer', requireDeveloper, upload.single('installer'), async (req, res) => {
  try {
    const game = await pool.query('SELECT developer_id FROM games WHERE id = $1', [req.params.id]);
    if (!game.rows[0] || game.rows[0].developer_id !== req.session.userId) {
      return res.status(403).json({ error: 'Yetkisiz' });
    }
    if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    // EXE için benzersiz key oluştur
    const { v4: uuidv4 } = require('uuid');
    const installerKey = uuidv4();

    await pool.query('UPDATE games SET upload_progress = 10, upload_status = $1 WHERE id = $2', ['uploading', req.params.id]);

    const url = await uploadFile(req.file.buffer, req.file.originalname, 'installers');

    await pool.query(
      'UPDATE games SET installer_url = $1, installer_key = $2, upload_progress = 100, upload_status = $3 WHERE id = $4',
      [url, installerKey, 'ready', req.params.id]
    );

    res.json({ success: true, url });
  } catch (err) {
    console.error(err);
    await pool.query('UPDATE games SET upload_status = $1 WHERE id = $2', ['error', req.params.id]);
    res.status(500).json({ error: 'Yükleme hatası' });
  }
});

// Yükleme durumu kontrol
router.get('/oyun/:id/yukleme-durum', requireDeveloper, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT upload_progress, upload_status FROM games WHERE id = $1 AND developer_id = $2',
      [req.params.id, req.session.userId]
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Oyunu yayınla
router.post('/oyun/:id/yayinla', requireDeveloper, async (req, res) => {
  try {
    const game = await pool.query('SELECT * FROM games WHERE id = $1 AND developer_id = $2', [req.params.id, req.session.userId]);
    if (!game.rows[0]) return res.status(404).json({ error: 'Oyun bulunamadı' });

    const g = game.rows[0];

    // Zorunlu kontroller
    if (!g.logo_url) return res.status(400).json({ error: 'Logo yüklenmemiş' });
    if (!g.banner_urls || g.banner_urls.length < 1) return res.status(400).json({ error: 'En az 1 banner gerekli' });
    if (!g.video_urls || g.video_urls.length < 2) return res.status(400).json({ error: 'En az 2 video gerekli' });
    if (!g.installer_url) return res.status(400).json({ error: 'Kurulum dosyası yüklenmemiş' });

    await pool.query('UPDATE games SET is_published = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Oyun güncelle
router.put('/oyun/:id', requireDeveloper, async (req, res) => {
  const { title, description, publisher_name, age_rating, price, genre_id } = req.body;
  try {
    const game = await pool.query('SELECT * FROM games WHERE id = $1 AND developer_id = $2', [req.params.id, req.session.userId]);
    if (!game.rows[0]) return res.status(404).json({ error: 'Oyun bulunamadı' });

    const profile = await pool.query('SELECT payment_unlocked FROM developer_profiles WHERE user_id = $1', [req.session.userId]);
    const paymentUnlocked = profile.rows[0]?.payment_unlocked || false;
    const finalPrice = paymentUnlocked ? (parseFloat(price) || 0) : 0;

    await pool.query(
      `UPDATE games SET title=$1, description=$2, publisher_name=$3, age_rating=$4, price=$5, is_free=$6, genre_id=$7, updated_at=NOW()
       WHERE id=$8 AND developer_id=$9`,
      [title, description, publisher_name, parseInt(age_rating) || 0, finalPrice, finalPrice === 0, genre_id || null, req.params.id, req.session.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Sözleşmeyi oku
router.get('/sozlesme/oyun-yukleme', (req, res) => {
  res.json({
    content: `DEMLIK PLATFORM OYUN YÜKLEME SÖZLEŞMESİ\n\n
1. Yüklediğiniz oyun tamamen size aittir ve üçüncü şahısların haklarını ihlal etmemelidir.
2. Zararlı yazılım, virüs veya kötü amaçlı kod içeren oyunlar kesinlikle yasaktır.
3. Yüklediğiniz oyun içerikleri Türkiye Cumhuriyeti yasalarına uygun olmalıdır.
4. Platform, uygunsuz içerikleri önceden haber vermeksizin kaldırma hakkını saklı tutar.
5. Oyununuzun indirme sayısı 500'ü geçtiğinde ücretli satışa başlayabilirsiniz.
6. Platform komisyonu gelecekte belirlenecektir.
7. Bu sözleşmeyi kabul ederek tüm maddeleri onaylamış sayılırsınız.`
  });
});

module.exports = router;
