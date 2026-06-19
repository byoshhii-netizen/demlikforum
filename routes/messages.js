const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { requireAuth } = require('../middleware');

const KUFUR_LISTESI = ['küfür1','küfür2','orospu','göt','amk','bok','sik','amına','yarrak','oç','piç'];

function kufurFiltrele(text) {
  let filtered = text;
  let found = false;
  KUFUR_LISTESI.forEach(k => {
    const regex = new RegExp(k, 'gi');
    if (regex.test(filtered)) { found = true; filtered = filtered.replace(regex, '***'); }
  });
  return { filtered, hasProfanity: found };
}

// Konuşma listesi
router.get('/konusmalar', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (other_user)
        CASE WHEN m.sender_id=$1 THEN m.receiver_id ELSE m.sender_id END as other_user,
        u.username, u.avatar_url,
        m.content as last_message, m.created_at
      FROM messages m
      JOIN users u ON u.id = CASE WHEN m.sender_id=$1 THEN m.receiver_id ELSE m.sender_id END
      WHERE (m.sender_id=$1 OR m.receiver_id=$1) AND m.is_deleted=false
      ORDER BY other_user, m.created_at DESC
    `, [req.session.userId]);
    res.json({ conversations: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Mesajları getir
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    // Engel kontrolü
    const blocked = await pool.query(
      'SELECT id FROM blocked_users WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',
      [req.session.userId, req.params.userId]
    );
    if (blocked.rows.length > 0) return res.status(403).json({ error: 'Bu kullanıcıyla mesajlaşamazsınız' });

    const result = await pool.query(`
      SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar
      FROM messages m JOIN users u ON m.sender_id=u.id
      WHERE ((m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1))
        AND m.is_deleted=false
      ORDER BY m.created_at ASC
    `, [req.session.userId, req.params.userId]);
    res.json({ messages: result.rows });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

// Mesaj gönder
router.post('/:userId', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });

  try {
    const sender = await pool.query('SELECT message_blocked FROM users WHERE id=$1', [req.session.userId]);
    if (sender.rows[0]?.message_blocked) return res.status(403).json({ error: 'Mesaj gönderme yetkiniz kısıtlandı' });

    const blocked = await pool.query(
      'SELECT id FROM blocked_users WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',
      [req.session.userId, req.params.userId]
    );
    if (blocked.rows.length > 0) return res.status(403).json({ error: 'Bu kullanıcıyla mesajlaşamazsınız' });

    // Aile denetimi - küfür kontrolü
    const parentCtrl = await pool.query(
      'SELECT allow_profanity, parent_first_name, parent_last_name FROM parental_controls WHERE user_id=$1 AND is_enabled=true',
      [req.params.userId]
    );

    let finalContent = content.trim();
    let wasFiltered = false;

    if (parentCtrl.rows.length > 0 && !parentCtrl.rows[0].allow_profanity) {
      const { hasProfanity, filtered } = kufurFiltrele(finalContent);
      if (hasProfanity) {
        const parent = parentCtrl.rows[0];
        finalContent = `Küfür yoook 🚫 *${parent.parent_first_name} ${parent.parent_last_name}*`;
        wasFiltered = true;
      }
    }

    const result = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1,$2,$3) RETURNING *',
      [req.session.userId, req.params.userId, finalContent]
    );
    res.json({ success: true, message: result.rows[0], filtered: wasFiltered });
  } catch (err) { res.status(500).json({ error: 'Sunucu hatası' }); }
});

module.exports = router;
