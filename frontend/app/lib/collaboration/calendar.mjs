export const COLLABORATION_TIME_ZONE = "Asia/Seoul";
function fail(message) { const error = new Error(message); error.status = 422; error.code = "COLLABORATION_INVALID_DATE"; throw error; }
/** A date-only value is a Korean calendar label, never a UTC instant. */
export function validateCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("날짜를 YYYY-MM-DD 형식으로 입력해 주세요.");
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail("실제로 존재하는 날짜를 입력해 주세요.");
  return value;
}
export function validateCalendarTime(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("시간을 HH:mm 형식으로 입력해 주세요.");
  return value;
}
export function addCalendarDays(value, count = 6) {
  validateCalendarDate(value);
  if (!Number.isSafeInteger(count) || Math.abs(count) > 36600) fail("날짜 이동 범위가 너무 큽니다.");
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  const output = date.toISOString().slice(0, 10);
  return validateCalendarDate(output);
}
export function todayInSeoul(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("현재 날짜를 확인할 수 없습니다.");
  return validateCalendarDate(new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10));
}
export function defaultTaskDueDate(value = new Date()) { return addCalendarDays(todayInSeoul(value), 6); }
/** Inclusive date spans make month rendering independent of host time zone. */
export function calendarDateInRange(date, startDate, endDate) {
  validateCalendarDate(date); validateCalendarDate(startDate); validateCalendarDate(endDate);
  return startDate <= date && date <= endDate;
}
