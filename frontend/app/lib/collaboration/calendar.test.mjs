import test from "node:test";
import assert from "node:assert/strict";
import { validateCalendarDate, validateCalendarTime, addCalendarDays, todayInSeoul, defaultTaskDueDate, calendarDateInRange } from "./calendar.mjs";

test("real Gregorian dates preserve Korean calendar labels across month and leap boundaries", () => {
  assert.equal(addCalendarDays("2026-10-18", 6), "2026-10-24");
  assert.equal(addCalendarDays("2026-12-28", 6), "2027-01-03");
  assert.equal(addCalendarDays("2028-02-24", 6), "2028-03-01");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCalendarDays("2000-02-28", 1), "2000-02-29");
  assert.equal(addCalendarDays("1900-02-28", 1), "1900-03-01");
  assert.equal(addCalendarDays("0001-01-01", 1), "0001-01-02");
  for (const date of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-00-02", "2026-13-01", "2026-01-00", "2026-1-01", "0000-01-01", "2026-10-18T00:00:00Z", "10/18/2026"]) assert.throws(() => validateCalendarDate(date), error => error.status === 422);
  for (const time of ["24:00", "12:60", "1:00", "00:00Z", ""]) assert.throws(() => validateCalendarTime(time), error => error.status === 422);
  assert.equal(validateCalendarTime("23:59"), "23:59");
});
test("today and six-calendar-day due date use Seoul midnight irrespective of UTC day", () => {
  assert.equal(todayInSeoul("2026-10-17T14:59:59.000Z"), "2026-10-17");
  assert.equal(todayInSeoul("2026-10-17T15:00:00.000Z"), "2026-10-18");
  assert.equal(defaultTaskDueDate("2026-10-17T15:00:00.000Z"), "2026-10-24");
  assert.equal(defaultTaskDueDate(new Date("2026-12-28T15:00:00Z")), "2027-01-04");
  assert.equal(calendarDateInRange("2026-10-20", "2026-10-18", "2026-10-20"), true);
  assert.equal(calendarDateInRange("2026-10-21", "2026-10-18", "2026-10-20"), false);
});
