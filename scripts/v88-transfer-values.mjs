export function transferValue(type, value) {
  if (value === null) return null;
  if (type === 'boolean') return Boolean(Number(value));
  // PostgreSQL emits a short decimal for REAL; compare both sides as float32.
  if (type === 'real') return Math.fround(Number(value));
  return value;
}
