const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { generate } = require('otplib');

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
  const verificationCode = getEmailParams('emailVerification').verification_code;
  response = await call('/api/auth/verify-email', 'POST', { email, code: verificationCode });
  assert.equal(response.status, 200);

  response = await call('/api/auth/login', 'POST', { identifier: username, password: 'correct-horse-battery' });
  assert.equal(response.status, 200);
  const loginChallenge = await response.json();
  assert.equal(loginChallenge.emailCodeRequired, true);
  const loginCode = getEmailParams('securityCode', (params) => params.verification_code).verification_code;
  response = await call('/api/auth/2fa/verify', 'POST', {
    challengeToken: loginChallenge.challengeToken,
    emailCode: loginCode
  });
  assert.equal(response.status, 200);
  return { ...(await response.json()), refreshCookie: response.headers.get('set-cookie').split(';')[0] };
}

function getEmailParams(template, predicate = () => true) {
  const entry = [...developmentLinks].reverse().find((line) => line.startsWith(`EMAILJS_TEST ${template} `));
  assert.ok(entry, `Expected an EmailJS ${template} test delivery`);
  const params = JSON.parse(entry.slice(entry.indexOf('{')));
  assert.ok(predicate(params), `Expected matching EmailJS parameters for ${template}`);
  return params;
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
  const initialCode = getEmailParams('emailVerification').verification_code;

  response = await call('/api/auth/resend-verification', 'POST', { email });
  assert.equal(response.status, 200);
  const resentCode = getEmailParams('emailVerification').verification_code;
  assert.notEqual(resentCode, initialCode);

  response = await call('/api/auth/verify-email', 'POST', { email, code: initialCode });
  assert.equal(response.status, 400);
  response = await call('/api/auth/verify-email', 'POST', { email, code: resentCode });
  assert.equal(response.status, 200);

  response = await call('/api/auth/forgot-password', 'POST', { email });
  assert.equal(response.status, 200);
  const forgotPasswordResult = await response.json();
  assert.equal('resetUrl' in forgotPasswordResult, false);
  const resetUrl = getEmailParams('passwordReset').reset_url;
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
  const loginChallenge = await response.json();
  const loginCode = getEmailParams('securityCode', (params) => params.verification_code).verification_code;
  response = await call('/api/auth/2fa/verify', 'POST', {
    challengeToken: loginChallenge.challengeToken,
    emailCode: loginCode
  });
  assert.equal(response.status, 200);
});

test('profile, email, and password changes require EmailJS verification codes', async () => {
  const username = `secure${Date.now().toString().slice(-5)}`;
  const account = await createAccount(username);

  let response = await call('/api/auth/me', 'PATCH', {
    username,
    age: account.user.age + 1
  }, account.accessToken);
  assert.equal(response.status, 200);
  const profileChallenge = await response.json();
  assert.equal(profileChallenge.verificationRequired, true);
  const profileCode = getEmailParams('securityCode', (params) =>
    params.message.includes('Profildaten')
  ).verification_code;
  response = await call('/api/auth/verify-action', 'POST', {
    challengeToken: profileChallenge.challengeToken,
    code: profileCode
  }, account.accessToken);
  assert.equal(response.status, 200);
  response = await call('/api/auth/me', 'GET', undefined, account.accessToken);
  assert.equal((await response.json()).user.age, account.user.age + 1);

  const newEmail = `${username}-new@example.com`;
  response = await call('/api/auth/change-email', 'POST', {
    newEmail,
    password: 'correct-horse-battery'
  }, account.accessToken);
  assert.equal(response.status, 200);
  const emailChange = await response.json();
  const oldEmailCode = getEmailParams('securityCode', (params) =>
    params.message.includes('bisherige E-Mail-Adresse')
  ).verification_code;
  response = await call('/api/auth/verify-action', 'POST', {
    challengeToken: emailChange.challengeToken,
    code: oldEmailCode
  }, account.accessToken);
  assert.equal(response.status, 200);
  const nextStep = await response.json();
  assert.equal(nextStep.nextStep, 'new_email');
  const newEmailCode = getEmailParams('securityCode', (params) =>
    params.purpose === 'Neue E-Mail-Adresse bestätigen'
  ).verification_code;
  response = await call('/api/auth/verify-action', 'POST', {
    challengeToken: emailChange.challengeToken,
    code: newEmailCode
  }, account.accessToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.email, newEmail);
  assert.ok(getEmailParams('securityCode', (params) =>
    params.purpose === 'E-Mail-Adresse geändert'
  ));

  response = await call('/api/auth/change-password', 'POST', {
    currentPassword: 'correct-horse-battery',
    newPassword: 'new-secure-correct-horse'
  }, account.accessToken);
  assert.equal(response.status, 200);
  const passwordChallenge = await response.json();
  const passwordCode = getEmailParams('securityCode', (params) =>
    params.message.includes('Passwortänderung abzuschließen')
  ).verification_code;
  response = await call('/api/auth/verify-action', 'POST', {
    challengeToken: passwordChallenge.challengeToken,
    code: passwordCode
  }, account.accessToken);
  assert.equal(response.status, 200);

  response = await call('/api/auth/login', 'POST', {
    identifier: username,
    password: 'new-secure-correct-horse'
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).emailCodeRequired, true);
});

test('authenticator 2FA activation and deactivation require EmailJS codes', async () => {
  const username = `twofa${Date.now().toString().slice(-5)}`;
  const account = await createAccount(username);
  let response = await call('/api/auth/2fa/setup', 'POST', {}, account.accessToken);
  assert.equal(response.status, 200);
  const setup = await response.json();
  const setupEmailCode = getEmailParams('securityCode', (params) =>
    params.message.includes('Aktivierung der Authenticator-2FA')
  ).verification_code;
  response = await call('/api/auth/2fa/enable', 'POST', {
    challengeToken: setup.challengeToken,
    emailCode: setupEmailCode,
    code: await generate({ secret: setup.secret })
  }, account.accessToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.totpEnabled, true);

  response = await call('/api/auth/2fa/disable', 'POST', {
    password: 'correct-horse-battery'
  }, account.accessToken);
  assert.equal(response.status, 200);
  const disable = await response.json();
  const disableEmailCode = getEmailParams('securityCode', (params) =>
    params.message.includes('deaktivieren')
  ).verification_code;
  response = await call('/api/auth/verify-action', 'POST', {
    challengeToken: disable.challengeToken,
    code: disableEmailCode
  }, account.accessToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.totpEnabled, false);
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
