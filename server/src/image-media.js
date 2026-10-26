'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const config = require('./config');

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: '.jpg', signature: (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/png', { extension: '.png', signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ['image/webp', { extension: '.webp', signature: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }]
]);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: 1, fields: 0, parts: 1 },
  fileFilter(req, file, callback) {
    if (!IMAGE_TYPES.has(file.mimetype)) {
      callback(new Error('Erlaubt sind JPG-, PNG- und WebP-Bilder.'));
      return;
    }
    callback(null, true);
  }
});

function imageUploadMiddleware(req, res, next) {
  imageUpload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'Bilder dürfen höchstens 5 MB groß sein.'
          : 'Bitte lade jeweils genau ein Bild hoch.'
      });
      return;
    }
    if (error.message === 'Erlaubt sind JPG-, PNG- und WebP-Bilder.') {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  });
}

function isValidImage(file) {
  const type = file && IMAGE_TYPES.get(file.mimetype);
  return Boolean(type && file.size > 0 && type.signature(file.buffer));
}

function saveImage(db, ownerId, file) {
  if (!isValidImage(file)) {
    const error = new Error('Der Dateityp oder Dateiinhalt wird nicht unterstützt.');
    error.status = 400;
    throw error;
  }

  const type = IMAGE_TYPES.get(file.mimetype);
  const id = crypto.randomUUID();
  const storageName = `${id}${type.extension}`;
  const directory = path.join(config.attachmentPath, 'profile-media');
  const filePath = path.join(directory, storageName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, file.buffer, { flag: 'wx' });
  try {
    db.prepare(`
      INSERT INTO image_assets (id, owner_id, storage_name, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, ownerId, storageName, file.mimetype, file.size);
  } catch (error) {
    fs.unlinkSync(filePath);
    throw error;
  }
  return { id, url: `/api/media/${id}` };
}

function deleteImageIfUnreferenced(db, imageUrl) {
  const match = typeof imageUrl === 'string' && imageUrl.match(/^\/api\/media\/([0-9a-f-]{36})$/i);
  if (!match) return;
  const id = match[1];
  const referenced = db.prepare(`
    SELECT 1
    FROM image_assets a
    WHERE a.id = ? AND (
      EXISTS (SELECT 1 FROM users u WHERE u.avatar_url = '/api/media/' || a.id OR u.banner_url = '/api/media/' || a.id)
      OR EXISTS (SELECT 1 FROM conversations c WHERE c.icon_url = '/api/media/' || a.id OR c.banner_url = '/api/media/' || a.id)
      OR EXISTS (SELECT 1 FROM servers s WHERE s.icon_url = '/api/media/' || a.id OR s.banner_url = '/api/media/' || a.id)
    )
  `).get(id);
  if (referenced) return;
  const asset = db.prepare('SELECT storage_name FROM image_assets WHERE id = ?').get(id);
  if (!asset) return;
  db.prepare('DELETE FROM image_assets WHERE id = ?').run(id);
  fs.rmSync(path.join(config.attachmentPath, 'profile-media', asset.storage_name), { force: true });
}

module.exports = {
  MAX_IMAGE_SIZE,
  imageUploadMiddleware,
  isValidImage,
  saveImage,
  deleteImageIfUnreferenced
};
