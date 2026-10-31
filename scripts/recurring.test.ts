// Run: npx tsx scripts/recurring.test.ts
import assert from "node:assert/strict";
import { addMonths, detectRecurring, dueDates, normaliseName, type Txn } from "../server/src/recurring.ts";
import { addDays } from "../server/src/util.ts";

const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); console.log("PASS", m); };
const tx = (date: string, amount: number, name: string, merchant: string | null = null): Txn => ({ date, amount, name, merchant });
const TODAY = "2026-10-31";

// names
eq(normaliseName("NETFLIX.COM 8812 SG"), normaliseName("Netflix.com 4410 SG"), "card reference numbers are ignored");
eq(addMonths("2026-01-31", 1), "2026-02-28", "month end is clamped");
eq(addMonths("2026-02-28", 1, 31), "2026-03-31", "anchor day comes back after a short month");

// monthly subscription, price creeps up a little
const netflix = [
  tx("2026-06-05", 15.98, "NETFLIX 1111"), tx("2026-07-05", 15.98, "NETFLIX 2222"), tx("2026-08-05", 15.98, "NETFLIX 3333"),
  tx("2026-09-05", 16.98, "NETFLIX 4444"), tx("2026-10-05", 16.98, "NETFLIX 5555"),
];
let r = detectRecurring(netflix, TODAY);
eq(r.length, 1, "monthly charge is found");
eq([r[0]!.cadence, r[0]!.amount, r[0]!.next_due, r[0]!.active, r[0]!.direction], ["monthly", 16.98, "2026-11-05", true, "expense"], "monthly details use the latest amount");

// weekly, biweekly, quarterly, yearly (two years is enough)
r = detectRecurring(Array.from({ length: 6 }, (_, i) => tx(addDays("2026-09-01", i * 7), 12, "Gym Pass")), TODAY);
eq(r[0]?.cadence, "weekly", "weekly");
r = detectRecurring([tx("2026-08-07", 40, "Phone"), tx("2026-08-21", 40, "Phone"), tx("2026-09-04", 40, "Phone"), tx("2026-09-18", 40, "Phone"), tx("2026-10-02", 40, "Phone"), tx("2026-10-16", 40, "Phone")], TODAY);
eq(r[0]?.cadence, "biweekly", "biweekly");
r = detectRecurring([tx("2026-01-10", 90, "Insurance"), tx("2026-04-10", 90, "Insurance"), tx("2026-07-10", 90, "Insurance")], TODAY);
eq([r[0]?.cadence, r[0]?.next_due], ["quarterly", "2026-10-10"], "quarterly");
r = detectRecurring([tx("2024-11-02", 120, "Domain"), tx("2025-11-02", 120, "Domain")], "2026-10-31");
eq([r[0]?.cadence, r[0]?.next_due, r[0]?.active], ["yearly", "2026-11-02", true], "yearly needs only two");

// income is its own group, with a monthly equivalent
r = detectRecurring([tx("2026-08-25", -3000, "SALARY ACME"), tx("2026-09-25", -3000, "SALARY ACME"), tx("2026-10-25", -3000, "SALARY ACME")], TODAY);
eq([r[0]?.direction, r[0]?.monthly], ["income", 3000], "salary is recurring income");

// not recurring
eq(detectRecurring([tx("2026-08-01", 8, "Cafe"), tx("2026-08-03", 6, "Cafe"), tx("2026-08-19", 9, "Cafe"), tx("2026-10-02", 7, "Cafe")], TODAY), [], "irregular visits are not recurring");
eq(detectRecurring([tx("2026-08-05", 10, "Shop"), tx("2026-09-05", 400, "Shop"), tx("2026-10-05", 35, "Shop")], TODAY), [], "regular date but wildly different amounts");
eq(detectRecurring([tx("2026-09-05", 15, "Spotify"), tx("2026-10-05", 15, "Spotify")], TODAY), [], "two monthly charges are not enough");
eq(detectRecurring([tx("2026-10-05", 15, "Retry"), tx("2026-10-05", 15, "Retry"), tx("2026-10-05", 15, "Retry")], TODAY), [], "same-day repeats are not a cycle");

// cancelled
r = detectRecurring([tx("2026-01-05", 9, "Old App"), tx("2026-02-05", 9, "Old App"), tx("2026-03-05", 9, "Old App")], TODAY);
eq(r[0]?.active, false, "series that stopped months ago is inactive");

// merchant beats raw name
r = detectRecurring([tx("2026-08-05", 10, "SP*A 1", "Spotify"), tx("2026-09-05", 10, "PAYPAL *B", "Spotify"), tx("2026-10-05", 10, "x", "Spotify")], TODAY);
eq([r.length, r[0]?.name], [1, "Spotify"], "grouped by merchant when there is one");

// projection
eq(dueDates({ cadence: "monthly", next_due: "2026-11-05", last_date: "2026-10-05" }, "2026-11-01", "2026-12-31"), ["2026-11-05", "2026-12-05"], "monthly projection");
eq(dueDates({ cadence: "weekly", next_due: "2026-11-02", last_date: "2026-10-26" }, "2026-11-10", "2026-11-24"), ["2026-11-16", "2026-11-23"], "projection skips dates before the window");
eq(dueDates({ cadence: "monthly", next_due: "2026-02-28", last_date: "2026-01-31" }, "2026-02-01", "2026-04-30"), ["2026-02-28", "2026-03-31", "2026-04-30"], "month-end anchor survives February");
console.log("all recurring tests passed");
