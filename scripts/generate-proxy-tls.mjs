/**
 * Generate self-signed TLS cert for tesla-http-proxy (localhost).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import selfsigned from 'selfsigned';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configDir = path.join(root, 'config');
const tlsKey = path.join(configDir, 'tls-key.pem');
const tlsCert = path.join(configDir, 'tls-cert.pem');
const fleetKey = path.join(root, 'keys', 'private-key.pem');

if (!fs.existsSync(fleetKey)) {
    console.error('ERROR: keys/private-key.pem not found. Run: npm run register');
    process.exit(1);
}

if (fs.existsSync(tlsCert)) {
    console.log('TLS certs already exist in config/ (skip). Delete tls-*.pem to regenerate.');
    process.exit(0);
}

fs.mkdirSync(configDir, { recursive: true });

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = await selfsigned.generate(attrs, {
    algorithm: 'sha256',
    days: 3650,
    keyType: 'ec',
    curve: 'P-384',
    extensions: [
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
            ],
        },
        { name: 'extKeyUsage', serverAuth: true, clientAuth: false },
    ],
});

fs.writeFileSync(tlsKey, pems.private);
fs.writeFileSync(tlsCert, pems.cert);
console.log('OK: config/tls-key.pem and config/tls-cert.pem created');
console.log('Next: npm run command-proxy');
