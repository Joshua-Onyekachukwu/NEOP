// One-off: upload VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID as
// GitHub Actions repo secrets using libsodium sealed_box (libsodium-wrappers).
// Secret values are read from the env and are never printed, logged, or
// written to disk.
//
// Usage: GH_TOKEN=... VERCEL_TOKEN=... VERCEL_ORG_ID=... VERCEL_PROJECT_ID=... \
//          node _scripts/gh-upload-secrets.cjs
const sodium = require("libsodium-wrappers");

const GH_TOKEN = process.env.GH_TOKEN;
const REPO = "Joshua-Onyekachukwu/NEOP";
const API = `https://api.github.com/repos/${REPO}/actions/secrets`;

if (!GH_TOKEN) {
  console.error("GH_TOKEN missing");
  process.exit(1);
}

// ── libsodium sealed_box (reference implementation)
function sealToBase64(publicKeyB64, plaintext) {
  const binkey = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const enc = sodium.crypto_box_seal(Buffer.from(plaintext, "utf8"), binkey);
  return sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
}

async function putSecret(name, value, publicKey, keyId) {
  const encrypted_value = sealToBase64(publicKey, value);
  const res = await fetch(`${API}/${name}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ encrypted_value, key_id: keyId }),
  });
  if (!res.ok) {
    console.error(`${name}: HTTP ${res.status}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: uploaded (value not shown)`);
  }
}

(async () => {
  await sodium.ready;
  const pkRes = await fetch(API + "/public-key", {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!pkRes.ok) {
    console.error("public-key fetch failed:", pkRes.status);
    process.exit(1);
  }
  const { key, key_id } = await pkRes.json();
  console.log("repo public key fetched:", key_id);

  const publicKey = key; // raw base64 string for libsodium from_base64

  const secrets = {
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) {
      console.error(`${name}: missing from env`);
      process.exitCode = 1;
      continue;
    }
    await putSecret(name, value, publicKey, key_id);
  }
})();

// NOTE: this one-off requires dev-only deps not present in package.json:
//   npm i -D libsodium-wrappers
// (installed ad hoc; removed from the manifest after the upload ran)
