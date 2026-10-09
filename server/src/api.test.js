const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'messenger-api-test-'));
process.env.DATABASE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const app = require('./app');
const db = require('./db');
const developmentLinks = [];
const originalInfo = console.info;
let server;
let baseUrl;

before(async () => {
  console.info = (...args) => developmentLinks.push(args.join(' '));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  console.info = originalInfo;
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function call(route, method = 'GET', body, accessToken, cookie) {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(cookie ? { cookie } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function callUpload(route, filename, content, contentType, accessToken) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: contentType }), filename);
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + accessToken },
    body: form
  });
}

async function createAccount(username) {
  const email = `${username}-${Date.now()}@example.com`;
  let response = await call('/api/auth/register', 'POST', {
    email,
    password: 'correct-horse-battery',
    username,
    age: 21
  });
  assert.equal(response.status, 201);

  const verificationUrl = developmentLinks.at(-1).split(' ').pop();
  const verificationToken = new URL(verificationUrl).searchParams.get('token');
  response = await call(`/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`);
  assert.equal(response.status, 200);

  response = await call('/api/auth/login', 'POST', { identifier: username, password: 'correct-horse-battery' });
  assert.equal(response.status, 200);
  return { ...(await response.json()), refreshCookie: response.headers.get('set-cookie').split(';')[0] };
}

test('friends can chat, read, edit, delete and block', async () => {
  const alice = await createAccount(`alice${Date.now().toString().slice(-5)}`);
  const bob = await createAccount(`bobby${Date.now().toString().slice(-5)}`);

  let response = await call(`/api/users/search?q=${bob.user.username.slice(0, 4)}`, 'GET', undefined, alice.accessToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).users[0].id, bob.user.id);

  response = await call('/api/friendships', 'POST', { username: bob.user.username }, alice.accessToken);
  assert.equal(response.status, 201);
  const request = await response.json();
  response = await call(`/api/friendships/${request.friendshipId}/accept`, 'POST', {}, bob.accessToken);
  assert.equal(response.status, 200);
  const { conversationId } = await response.json();

  response = await call(`/api/conversations/${conversationId}/messages`, 'POST', { body: 'Hello there' }, alice.accessToken);
  assert.equal(response.status, 201);
  const originalMessage = (await response.json()).message;
  response = await call(`/api/messages/${originalMessage.id}/reactions`, 'POST', { emoji: '👍' }, alice.accessToken);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).reactions, [{ emoji: '👍', count: 1, reactedByMe: true }]);
  response = await call(`/api/messages/${originalMessage.id}/reactions`, 'POST', { emoji: '👍' }, bob.accessToken);
  assert.equal((await response.json()).reactions[0].count, 2);
  response = await call(`/api/conversations/${conversationId}/messages`, 'GET', undefined, alice.accessToken);
  assert.deepEqual((await response.json()).messages[0].reactions, [{ emoji: '👍', count: 2, reactedByMe: true }]);
  response = await call(`/api/messages/${originalMessage.id}/reactions`, 'POST', { emoji: '👍' }, alice.accessToken);
  assert.deepEqual((await response.json()).reactions, [{ emoji: '👍', count: 1, reactedByMe: false }]);
  response = await call(`/api/messages/${originalMessage.id}/reactions`, 'POST', { emoji: '<script>' }, alice.accessToken);
  assert.equal(response.status, 400);

  response = await call('/api/conversations', 'GET', undefined, bob.accessToken);
  assert.equal((await response.json()).conversations[0].unreadCount, 1);

  response = await call(`/api/conversations/${conversationId}/read`, 'POST', {}, bob.accessToken);
  assert.equal(response.status, 200);
  response = await call(`/api/conversations/${conversationId}/messages`, 'GET', undefined, alice.accessToken);
  assert.equal((await response.json()).messages[0].readCount, 1);

  response = await call(`/api/messages/${originalMessage.id}`, 'PATCH', { body: 'Edited hello' }, alice.accessToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message.body, 'Edited hello');

  response = await call(`/api/conversations/${conversationId}/messages`, 'POST', {
    body: 'A reply',
    replyTo: originalMessage.id
  }, bob.accessToken);
  assert.equal(response.status, 201);
  const reply = (await response.json()).message;
  response = await call(`/api/messages/${reply.id}`, 'DELETE', { scope: 'me' }, bob.accessToken);
  assert.equal(response.status, 204);

  response = await call(`/api/messages/${originalMessage.id}`, 'DELETE', { scope: 'everyone' }, alice.accessToken);
  assert.equal(response.status, 204);
  response = await call(`/api/conversations/${conversationId}/messages`, 'GET', undefined, bob.accessToken);
  assert.equal((await response.json()).messages[0].deletedAt !== null, true);

  response = await call('/api/blocks', 'POST', { userId: bob.user.id }, alice.accessToken);
  assert.equal(response.status, 201);
  response = await call(`/api/conversations/${conversationId}/messages`, 'POST', { body: 'Blocked' }, bob.accessToken);
  assert.equal(response.status, 404);

  response = await call('/api/auth/logout', 'POST', undefined, alice.accessToken, alice.refreshCookie);
  assert.equal(response.status, 204);
  response = await call('/api/friendships', 'GET', undefined, alice.accessToken);
  assert.equal(response.status, 401);
});

test('verification can be resent and password reset links complete the account flow', async () => {
  const username = `reset${Date.now().toString().slice(-5)}`;
  const email = `${username}@example.com`;
  let response = await call('/api/auth/register', 'POST', {
    email,
    password: 'correct-horse-battery',
    username,
    age: 24
  });
  assert.equal(response.status, 201);
  const initialVerificationUrl = developmentLinks.at(-1).split(' ').pop();
  const initialToken = new URL(initialVerificationUrl).searchParams.get('token');

  response = await call('/api/auth/resend-verification', 'POST', { email });
  assert.equal(response.status, 200);
  const resentVerificationUrl = developmentLinks.at(-1).split(' ').pop();
  const resentToken = new URL(resentVerificationUrl).searchParams.get('token');
  assert.notEqual(resentToken, initialToken);

  response = await call(`/api/auth/verify-email?token=${encodeURIComponent(initialToken)}`);
  assert.equal(response.status, 400);
  response = await call(`/api/auth/verify-email?token=${encodeURIComponent(resentToken)}`);
  assert.equal(response.status, 200);

  response = await call('/api/auth/forgot-password', 'POST', { email });
  assert.equal(response.status, 200);
  const resetUrl = developmentLinks.at(-1).split(' ').pop();
  const resetToken = new URL(resetUrl).searchParams.get('token');
  response = await call('/api/auth/reset-password', 'POST', {
    token: resetToken,
    password: 'new-correct-horse-battery'
  });
  assert.equal(response.status, 200);

  response = await call('/api/auth/login', 'POST', {
    identifier: username,
    password: 'new-correct-horse-battery'
  });
  assert.equal(response.status, 200);
});

test('group administration and private file attachments enforce membership and content validation', async () => {
  const alice = await createAccount(`admin${Date.now().toString().slice(-5)}`);
  const bob = await createAccount(`member${Date.now().toString().slice(-5)}`);
  const carol = await createAccount(`third${Date.now().toString().slice(-5)}`);

  async function makeFriends(first, second) {
    let response = await call('/api/friendships', 'POST', { username: second.user.username }, first.accessToken);
    assert.equal(response.status, 201);
    const request = await response.json();
    response = await call(`/api/friendships/${request.friendshipId}/accept`, 'POST', {}, second.accessToken);
    assert.equal(response.status, 200);
  }
  await makeFriends(alice, bob);
  await makeFriends(alice, carol);

  let response = await call('/api/groups', 'POST', {
    name: 'Testgruppe',
    memberIds: [bob.user.id, carol.user.id]
  }, alice.accessToken);
  assert.equal(response.status, 201);
  const { conversationId } = await response.json();

  response = await call(`/api/groups/${conversationId}`, 'GET', undefined, bob.accessToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).group.members.length, 3);
  response = await call(`/api/groups/${conversationId}`, 'PATCH', { name: 'Neue Gruppe' }, bob.accessToken);
  assert.equal(response.status, 403);
  response = await call(`/api/groups/${conversationId}`, 'PATCH', { name: 'Neue Gruppe' }, alice.accessToken);
  assert.equal(response.status, 200);
  response = await call(`/api/groups/${conversationId}/members/${bob.user.id}`, 'PATCH', { role: 'admin' }, alice.accessToken);
  assert.equal(response.status, 200);
  response = await call(`/api/groups/${conversationId}/members/${alice.user.id}`, 'PATCH', { role: 'member' }, alice.accessToken);
  assert.equal(response.status, 200);
  response = await call(`/api/groups/${conversationId}/members/${bob.user.id}`, 'PATCH', { role: 'member' }, bob.accessToken);
  assert.equal(response.status, 409);

  response = await callUpload(
    `/api/conversations/${conversationId}/attachments`,
    'notiz.pdf',
    Buffer.from('%PDF-1.4\nsample document'),
    'application/pdf',
    alice.accessToken
  );
  assert.equal(response.status, 201);
  const uploadedMessage = (await response.json()).message;
  assert.equal(uploadedMessage.attachment.name, 'notiz.pdf');
  assert.equal(uploadedMessage.attachment.mimeType, 'application/pdf');
  response = await call('/api/conversations', 'GET', undefined, alice.accessToken);
  assert.equal((await response.json()).conversations[0].lastMessage, '📎 notiz.pdf');

  response = await fetch(`${baseUrl}${uploadedMessage.attachment.url}`, {
    headers: { authorization: 'Bearer ' + alice.accessToken }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(await response.text(), '%PDF-1.4\nsample document');
  response = await fetch(`${baseUrl}${uploadedMessage.attachment.url}`, {
    headers: { authorization: 'Bearer ' + carol.accessToken }
  });
  assert.equal(response.status, 200);

  response = await callUpload(
    `/api/conversations/${conversationId}/attachments`,
    'fake.pdf',
    Buffer.from('<script>alert(1)</script>'),
    'application/pdf',
    alice.accessToken
  );
  assert.equal(response.status, 400);
  response = await callUpload(
    `/api/conversations/${conversationId}/attachments`,
    'image.svg',
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    'image/svg+xml',
    alice.accessToken
  );
  assert.equal(response.status, 400);

  const outsider = await createAccount(`outsider${Date.now().toString().slice(-5)}`);
  response = await fetch(`${baseUrl}${uploadedMessage.attachment.url}`, {
    headers: { authorization: 'Bearer ' + outsider.accessToken }
  });
  assert.equal(response.status, 404);
  response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
    headers: { authorization: 'Bearer ' + outsider.accessToken }
  });
  assert.equal(response.status, 404);

  response = await call(`/api/groups/${conversationId}/members/${carol.user.id}`, 'DELETE', undefined, bob.accessToken);
  assert.equal(response.status, 204);
  response = await fetch(`${baseUrl}${uploadedMessage.attachment.url}`, {
    headers: { authorization: 'Bearer ' + carol.accessToken }
  });
  assert.equal(response.status, 404);

  response = await call(`/api/messages/${uploadedMessage.id}`, 'DELETE', { scope: 'everyone' }, alice.accessToken);
  assert.equal(response.status, 204);
  response = await fetch(`${baseUrl}${uploadedMessage.attachment.url}`, {
    headers: { authorization: 'Bearer ' + outsider.accessToken }
  });
  assert.equal(response.status, 404);

  response = await call(`/api/groups/${conversationId}/members/${alice.user.id}`, 'DELETE', undefined, bob.accessToken);
  assert.equal(response.status, 204);
  await call('/api/auth/logout', 'POST', undefined, outsider.accessToken, outsider.refreshCookie);
});
