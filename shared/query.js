// Validate known public API inputs before performing provider work.
export function readQuery(query, key, fallback = "", maxLength = 250) {
  const value = query?.[key];
  if (value == null) return fallback;
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new RangeError(`Invalid ${key} parameter.`);
  return value;
}
export function integerQuery(query, key, fallback, min, max) {
  const value = readQuery(query, key, "", 16);
  if (!value) return fallback;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new RangeError(`Invalid ${key} parameter.`);
  return Number(value);
}
