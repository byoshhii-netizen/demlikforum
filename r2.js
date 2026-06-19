require('dotenv').config();
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = `${process.env.R2_ENDPOINT}/${BUCKET}`;

async function uploadFile(buffer, originalName, folder = 'misc') {
  const ext = originalName.split('.').pop().toLowerCase();
  const key = `${folder}/${uuidv4()}.${ext}`;

  await r2Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: getMimeType(ext),
  }));

  return `${PUBLIC_URL}/${key}`;
}

async function deleteFile(url) {
  try {
    const key = url.replace(`${PUBLIC_URL}/`, '');
    await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error('R2 silme hatası:', err);
  }
}

async function getPresignedUploadUrl(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return await getSignedUrl(r2Client, command, { expiresIn: 3600 });
}

async function getPresignedDownloadUrl(key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return await getSignedUrl(r2Client, command, { expiresIn: 300 });
}

function getMimeType(ext) {
  const types = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', webm: 'video/webm', avi: 'video/avi',
    exe: 'application/octet-stream', zip: 'application/zip',
    rar: 'application/x-rar-compressed', msi: 'application/x-msi',
  };
  return types[ext] || 'application/octet-stream';
}

module.exports = { uploadFile, deleteFile, getPresignedUploadUrl, getPresignedDownloadUrl, PUBLIC_URL, BUCKET };
