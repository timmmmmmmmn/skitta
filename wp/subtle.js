// WebCrypto in pure JS voor EdgeHTML: daar ontbreken PBKDF2, HKDF en ECDH met pkcs8. Alleen wat app.js
// gebruikt. Sleutels zijn gewone objecten (kunnen zo in IndexedDB) en de formaten (raw, pkcs8) zijn
// dezelfde als in Chrome/Firefox/Safari, zodat een account op de Lumia en op andere apparaten werkt.
import { p256 } from '@noble/curves/p256';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { hkdf } from '@noble/hashes/hkdf';
import { gcm } from '@noble/ciphers/aes';

const bytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const naam = (a) => (typeof a === 'string' ? a : a.name).toUpperCase();
const sleutel = (type, alg, raw, extra) => ({ type, algorithm: { name: alg }, extractable: true, usages: [], wp: raw, ...extra });
const buf = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);

// PKCS#8 voor P-256 zoals Chrome hem maakt (met het publieke deel erin)
const PKCS8_KOP = [0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02, 0x01, 0x01, 0x04, 0x20];
const PKCS8_MID = [0xa1, 0x44, 0x03, 0x42, 0x00];
function naarPkcs8(priv) {
  const pub = p256.getPublicKey(priv, false);
  return new Uint8Array([...PKCS8_KOP, ...priv, ...PKCS8_MID, ...pub]);
}
function uitPkcs8(der) {
  // het geheime getal staat na INTEGER 1, OCTET STRING (32)
  for (let i = 0; i < der.length - 36; i++) {
    if (der[i] === 0x02 && der[i + 1] === 0x01 && der[i + 2] === 0x01 && der[i + 3] === 0x04 && der[i + 4] === 0x20) return der.slice(i + 5, i + 37);
  }
  throw new Error('onbekende pkcs8-sleutel');
}

export const subtle = {
  async importKey(fmt, data, alg, extractable, usages) {
    const n = naam(alg), d = bytes(data).slice();
    if (n === 'ECDH') {
      if (fmt === 'raw') { p256.ProjectivePoint.fromHex(d); return sleutel('public', n, d); }
      if (fmt === 'pkcs8') return sleutel('private', n, uitPkcs8(d));
    }
    if (fmt === 'raw' && (n === 'AES-GCM' || n === 'PBKDF2' || n === 'HKDF')) return sleutel('secret', n, d);
    throw new Error(`importKey ${fmt} ${n} niet ondersteund`);
  },
  async exportKey(fmt, k) {
    if (fmt === 'raw' && k.type === 'public') return buf(k.wp);
    if (fmt === 'raw' && k.type === 'secret') return buf(k.wp);
    if (fmt === 'pkcs8' && k.type === 'private') return buf(naarPkcs8(k.wp));
    throw new Error(`exportKey ${fmt} niet ondersteund`);
  },
  async generateKey(alg) {
    if (naam(alg) !== 'ECDH') throw new Error('generateKey: alleen ECDH');
    const priv = p256.utils.randomPrivateKey();
    return { privateKey: sleutel('private', 'ECDH', priv), publicKey: sleutel('public', 'ECDH', p256.getPublicKey(priv, false)) };
  },
  async deriveBits(alg, k, lengte) {
    const n = naam(alg), len = lengte / 8;
    if (n === 'PBKDF2') {
      const h = /512/.test(naam(alg.hash)) ? sha512 : sha256;
      return buf(await pbkdf2Async(h, k.wp, bytes(alg.salt), { c: alg.iterations, dkLen: len, asyncTick: 30 }));
    }
    if (n === 'ECDH') return buf(p256.getSharedSecret(k.wp, alg.public.wp, true).slice(1, 1 + len));
    if (n === 'HKDF') return buf(hkdf(sha256, k.wp, bytes(alg.salt), bytes(alg.info), len));
    throw new Error(`deriveBits ${n} niet ondersteund`);
  },
  async deriveKey(alg, k, doel) {
    const raw = new Uint8Array(await this.deriveBits(alg, k, doel.length || 256));
    return sleutel('secret', naam(doel), raw);
  },
  async encrypt(alg, k, data) {
    return buf(gcm(k.wp, bytes(alg.iv)).encrypt(bytes(data)));
  },
  async decrypt(alg, k, data) {
    return buf(gcm(k.wp, bytes(alg.iv)).decrypt(bytes(data)));
  },
  async digest(alg, data) {
    return buf((/512/.test(naam(alg)) ? sha512 : sha256)(bytes(data)));
  },
};
window.__wpSubtle = subtle;
