/* TrainingTrail — coffre de chiffrement de bout en bout (WebCrypto, zéro dépendance).

   Principe : le mot de passe ne quitte JAMAIS l'appareil. Il sert à dériver
   deux clés (PBKDF2-HMAC-SHA256, 600 000 itérations, sel de 16 octets) :
     - une clé AES-GCM 256 qui chiffre les données (état complet, traces GPS)
       AVANT tout envoi et avant toute écriture dans localStorage : le serveur
       et le navigateur ne voient et ne stockent que du chiffré ;
     - une clé d'accès (apiKey), envoyée dans l'en-tête X-TT-Key, qui prouve la
       connaissance du mot de passe au serveur. Celui-ci n'en garde que le
       SHA-256 : ni le mot de passe, ni la clé, ni les données en clair.

   Format d'un blob : { enc: 1, salt, iv, ct } (base64). Le sel est public — il
   voyage avec le blob pour que les autres appareils puissent dériver les clés ;
   sans le mot de passe, le chiffré est opaque (AES-GCM : authentifié, toute
   altération est détectée). */

const VAULT_LS_KEY = "trainingtrail_v1_enc";
const Vault = {
  ITER: 600000,
  AAD_STATE: "trainingtrail:state:v1",
  AAD_TRACK: "trainingtrail:track:v1",

  salt: null,        // b64(16 octets) — public, voyage avec les blobs
  key: null,         // CryptoKey AES-GCM 256 — en mémoire uniquement
  apiKey: null,      // b64(32 octets) — en mémoire uniquement
  pendingBlob: null, // blob local en attente de déverrouillage (au chargement)

  get ready() { return !!this.key; },
  headers() { return this.apiKey ? { "X-TT-Key": this.apiKey } : {}; },

  /* blob chiffré rangé dans localStorage (null si aucun) */
  localBlob() {
    try {
      const raw = localStorage.getItem(VAULT_LS_KEY);
      const b = raw ? JSON.parse(raw) : null;
      return b && b.enc === 1 ? b : null;
    } catch (e) { return null; }
  },

  /* dérivation pure : renvoie les clés SENS modifier le coffre (vérification
     d'un mot de passe avant adoption, changement de mot de passe…) */
  async deriveKeys(password, saltB64) {
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64dec(saltB64), iterations: this.ITER },
      base, 512); /* 64 octets : 32 de chiffrement + 32 d'accès */
    return {
      salt: saltB64,
      key: await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]),
      apiKey: b64enc(bits.slice(32))
    };
  },
  async derive(password, saltB64) { this.adopt(await this.deriveKeys(password, saltB64)); },
  adopt(keys) { this.salt = keys.salt; this.key = keys.key; this.apiKey = keys.apiKey; },

  /* création du coffre : nouveau sel aléatoire, clés dérivées, mémorisées */
  async create(password) {
    await this.derive(password, b64enc(crypto.getRandomValues(new Uint8Array(16))));
  },

  /* chiffre un objet quelconque -> blob {enc, salt, iv, ct} (IV aléatoire) */
  async seal(obj, aad) {
    if (!this.key) throw new Error("coffre verrouillé");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: aad ? new TextEncoder().encode(aad) : undefined },
      this.key, new TextEncoder().encode(JSON.stringify(obj)));
    return { enc: 1, salt: this.salt, iv: b64enc(iv), ct: b64enc(ct) };
  },

  /* déchiffre un blob -> objet ; échoue (tag invalide) si clé/mot de passe faux */
  async open(blob, aad) {
    if (!blob || blob.enc !== 1 || !blob.iv || !blob.ct) throw new Error("blob invalide");
    if (!this.key) throw new Error("coffre verrouillé");
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64dec(blob.iv), additionalData: aad ? new TextEncoder().encode(aad) : undefined },
      this.key, b64dec(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  },

  /* variante avec des clés extérieures (déverrouillage en cours de vérification) */
  async openWith(keys, blob, aad) {
    const saved = [this.salt, this.key, this.apiKey];
    this.salt = keys.salt; this.key = keys.key; this.apiKey = keys.apiKey;
    try { return await this.open(blob, aad); }
    catch (e) { this.salt = saved[0]; this.key = saved[1]; this.apiKey = saved[2]; throw e; }
  },

  /* SHA-256 de l'apiKey — la seule valeur que le serveur stocke */
  async keyHash() {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.apiKey));
    return b64enc(h);
  },

  /* oublie les clés (elles n'existent qu'en mémoire : la page s'en va, tout s'efface) */
  lock() {
    this.key = null; this.apiKey = null;
    if (!this.pendingBlob) this.pendingBlob = this.localBlob();
  }
};

function b64enc(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function b64dec(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
