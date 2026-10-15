// Disposable integration-only OIDC issuer; never deploy this as a real identity provider.
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, createHash, sign } from 'node:crypto';

const issuer = process.env.ISSUER_URL;
const clientId = 'agentmemory-integration';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'integration', use: 'sig', alg: 'RS256' };
const codes = new Map();
const user = { sub: 'integration-user', email: 'agent@test.example', email_verified: true, preferred_username: 'agent', groups: ['agentmemory-users'] };
function jwt(nonce, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode({ alg: 'RS256', kid: 'integration' })}.${encode({ ...user, iss: issuer, aud: clientId, nonce, iat: now, exp: now + 300, ...claims })}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}
createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/.well-known/openid-configuration') return json(200, {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/keys`, userinfo_endpoint: `${issuer}/userinfo`, response_types_supported: ['code'],
    subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'], code_challenge_methods_supported: ['S256'],
  });
  if (url.pathname === '/keys') return json(200, { keys: [jwk] });
  // Test-only token issuance: this entire fixture is an intentionally fake identity provider.
  if (url.pathname === '/test-tokens') return json(200, {
    valid: jwt(), expired: jwt(undefined, { exp: 1 }),
    wrongAudience: jwt(undefined, { aud: 'another-service' }),
    wrongIssuer: jwt(undefined, { iss: 'https://untrusted.example.com' }),
  });
  if (url.pathname === '/userinfo') return json(200, user);
  if (url.pathname === '/authorize') {
    if (url.searchParams.get('client_id') !== clientId || url.searchParams.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
    const code = randomBytes(24).toString('hex');
    codes.set(code, { nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'),
      groups: url.searchParams.get('test_no_groups') === 'true' ? [] : user.groups });
    const target = new URL(url.searchParams.get('redirect_uri'));
    target.searchParams.set('code', code);
    target.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { Location: target.href }); res.end(); return;
  }
  if (url.pathname === '/token') {
    let body = ''; for await (const chunk of req) body += chunk;
    const values = new URLSearchParams(body);
    const basic = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
    const secret = basic.includes(':') ? decodeURIComponent(basic.slice(basic.indexOf(':') + 1)) : values.get('client_secret');
    if (secret !== process.env.CLIENT_SECRET) return json(401, { error: 'invalid_client' });
    const record = codes.get(values.get('code'));
    codes.delete(values.get('code'));
    const challenge = createHash('sha256').update(values.get('code_verifier') || '').digest('base64url');
    if (!record || challenge !== record.challenge) return json(400, { error: 'invalid_grant' });
    return json(200, { access_token: randomBytes(24).toString('hex'), token_type: 'Bearer', expires_in: 300, id_token: jwt(record.nonce, { groups: record.groups }) });
  }
  return json(404, { error: 'not_found' });
}).listen(8080, '0.0.0.0');
