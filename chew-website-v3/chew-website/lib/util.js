// lib/util.js
//
// Small, genuinely-shared pure helpers with no database/network access.
// Kept separate from any one feature's model file so a second real user
// doesn't have to duplicate it — see lib/leverageModel.js and
// lib/weatherModel.js, both of which need deterministic, key-order-
// independent state comparison for real reasons (evidence dedup and
// state-fingerprint dedup respectively).

// Postgres's jsonb type does not preserve object key insertion order —
// it canonicalizes on write, so a value read back from a jsonb column
// can have keys in a different order than the JS object literal that
// produced it, even when every field value is identical. A plain
// JSON.stringify comparison would treat that as a mismatch. Sorting
// keys recursively before comparing/hashing removes that false signal.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

module.exports = { stableStringify };
