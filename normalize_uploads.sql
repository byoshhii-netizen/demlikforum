-- normalize_uploads.sql
-- PREVIEW: list songs with non-http non-data audio/cover URLs
SELECT id, slug, audio_url FROM songs
 WHERE audio_url IS NOT NULL AND audio_url <> '' AND audio_url NOT ILIKE 'http%' AND audio_url NOT ILIKE 'data:%'
 ORDER BY id DESC LIMIT 200;

SELECT id, slug, cover_url FROM songs
 WHERE cover_url IS NOT NULL AND cover_url <> '' AND cover_url NOT ILIKE 'http%' AND cover_url NOT ILIKE 'data:%'
 ORDER BY id DESC LIMIT 200;

-- BACKUP: create a backup table of current media URLs
CREATE TABLE IF NOT EXISTS songs_media_backup AS
 SELECT id, audio_url, cover_url, slug FROM songs
 WHERE (audio_url IS NOT NULL AND audio_url <> '') OR (cover_url IS NOT NULL AND cover_url <> '');

-- NORMALIZE: convert stored paths to /uploads/<basename>
UPDATE songs
 SET audio_url = '/uploads/' || regexp_replace(audio_url, '^.*[/\\\\]', '')
 WHERE audio_url IS NOT NULL AND audio_url <> '' AND audio_url NOT ILIKE 'http%' AND audio_url NOT ILIKE 'data:%';

UPDATE songs
 SET cover_url = '/uploads/' || regexp_replace(cover_url, '^.*[/\\\\]', '')
 WHERE cover_url IS NOT NULL AND cover_url <> '' AND cover_url NOT ILIKE 'http%' AND cover_url NOT ILIKE 'data:%';

-- VERIFY: list normalized rows
SELECT id, slug, audio_url, cover_url FROM songs
 WHERE audio_url LIKE '/uploads/%' OR cover_url LIKE '/uploads/%'
 ORDER BY id DESC LIMIT 200;

-- ROLLBACK (if needed): restore from backup
-- UPDATE songs s
--  SET audio_url = b.audio_url, cover_url = b.cover_url
--  FROM songs_media_backup b
--  WHERE s.id = b.id;
