const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { requireAuth } = require('../middleware');

// Arkadaş listesi
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.avatar_url, u.role,
        CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END as friend_id,
        f.status, f.created_at
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
      WHERE (f.requester_id=$1 OR f.addressee_id=$1) AND f.status='accepted'
    `, [req.session.userId]);
    res.json({ friends: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Gelen istekler
router.get('/istekler', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.id, u.id as sender_id, u.username, u.avatar_url, f.created_at
      FROM friendships f JOIN users u ON f.requester_id=u.id
      WHERE f.addressee_id=$1 AND f.status='pending'
    `, [req.session.userId]);
    res.json({ requests: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// İstek gönder
router.post('/istek/:userId', requireAuth, async (req, res) => {
  if (req.params.userId === req.session.userId) return res.status(400).json({ error: 'Kendinize istek gönderemezsiniz' });
  try {
    const target = await pool.query('SELECT friend_blocked FROM users WHERE id=$1', [req.params.userId]);
    if (!target.rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (target.rows[0].friend_blocked) return res.status(403).json({ error: 'Bu kullanıcıya istek gönderilemiyor' });

    await pool.query(
      'INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.session.userId, req.params.userId, 'pending']
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Kabul et
router.post('/kabul/:friendshipId', requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE friendships SET status='accepted' WHERE id=$1 AND addressee_id=$2",
      [req.params.friendshipId, req.session.userId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Reddet / Sil
router.delete('/:friendshipId', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM friendships WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2)',
      [req.params.friendshipId, req.session.userId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

module.exports = router;
