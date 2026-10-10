const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createAccessToken(user, sessionId) {
  return jwt.sign({ username: user.username, ver: user.auth_version, sid: sessionId }, config.accessSecret, {
    subject: user.id,
    expiresIn: config.accessTokenTtl,
    issuer: 'messenger-app'
  });
}

function createRefreshToken(userId, sessionId) {
  return jwt.sign({ sid: sessionId }, config.refreshSecret, {
    subject: userId,
    expiresIn: config.refreshTokenTtl,
    issuer: 'messenger-app'
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.accessSecret, { issuer: 'messenger-app' });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.refreshSecret, { issuer: 'messenger-app' });
}

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: config.useSecureCookies,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: config.refreshTokenTtlMs
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.useSecureCookies,
    sameSite: 'strict',
    path: '/api/auth'
  });
}

module.exports = {
  bcrypt,
  clearRefreshCookie,
  createAccessToken,
  createOpaqueToken,
  createRefreshToken,
  hashToken,
  setRefreshCookie,
  verifyAccessToken,
  verifyRefreshToken
};
