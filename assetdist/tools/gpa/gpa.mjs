// 학점 계산. Pure functions shared by the page and its tests.
// P(통과)는 이수학점에만, NP는 어디에도 넣지 않고, F는 평점(0점)에는 넣되 이수학점에서는 빼요.

export const SCALES = {
  '4.5': { max: 4.5, grades: [['A+', 4.5], ['A0', 4.0], ['B+', 3.5], ['B0', 3.0], ['C+', 2.5], ['C0', 2.0], ['D+', 1.5], ['D0', 1.0], ['F', 0]] },
  '4.3': { max: 4.3, grades: [['A+', 4.3], ['A', 4.0], ['A-', 3.7], ['B+', 3.3], ['B', 3.0], ['B-', 2.7], ['C+', 2.3], ['C', 2.0], ['C-', 1.7], ['D+', 1.3], ['D', 1.0], ['D-', 0.7], ['F', 0]] },
};
export const PASS_FAIL = ['P', 'NP'];

const points = (scale, grade) => SCALES[scale]?.grades.find(([g]) => g === grade)?.[1];

/** courses: [{ credits, grade, major, term }] → totals for GPA and earned credits. */
export function summarize(courses, scale = '4.5') {
  const total = { gpaCredits: 0, points: 0, earned: 0, majorCredits: 0, majorPoints: 0, passCredits: 0 };
  for (const course of courses) {
    const credits = Number(course.credits);
    if (!(credits > 0)) continue;
    if (course.grade === 'P') { total.earned += credits; total.passCredits += credits; continue; }
    if (course.grade === 'NP') continue;
    const value = points(scale, course.grade);
    if (value === undefined) continue;
    total.gpaCredits += credits;
    total.points += value * credits;
    if (value > 0) total.earned += credits;
    if (course.major) { total.majorCredits += credits; total.majorPoints += value * credits; }
  }
  return {
    ...total,
    gpa: total.gpaCredits ? total.points / total.gpaCredits : null,
    majorGpa: total.majorCredits ? total.majorPoints / total.majorCredits : null,
  };
}

/** Per-term summaries in first-seen order. */
export function byTerm(courses, scale = '4.5') {
  const terms = [];
  for (const course of courses) if (!terms.includes(course.term || '')) terms.push(course.term || '');
  return terms.map((term) => ({ term, ...summarize(courses.filter((c) => (c.term || '') === term), scale) }));
}

/** Truncates to two decimals, as many transcripts print it. */
export const truncate2 = (value) => (value === null ? null : Math.floor(value * 100 + 1e-9) / 100);

/** Proportional conversion between scales; schools and employers may use their own tables. */
export const convert = (gpa, fromMax, toMax) => (gpa === null ? null : (gpa / fromMax) * toMax);

/** Average needed over the remaining credits to reach the target GPA; null when no credits remain. */
export function neededAverage({ gpa, credits, remaining, target }) {
  if (!(remaining > 0)) return null;
  return (target * (credits + remaining) - (gpa || 0) * credits) / remaining;
}
