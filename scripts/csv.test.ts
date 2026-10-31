// Run: npx tsx scripts/csv.test.ts
import assert from "node:assert/strict";
import { guessMapping, inferDateFormat, parseAmount, parseCsv, parseDate } from "../server/src/csv.ts";

const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); console.log("PASS", m); };

// amounts
eq(parseAmount("1,234.56"), 1234.56, "us thousands");
eq(parseAmount("1.234,56"), 1234.56, "eu thousands");
eq(parseAmount("12,50"), 12.5, "decimal comma");
eq(parseAmount("1,234"), 1234, "comma thousands, no decimals");
eq(parseAmount("(45.10)"), -45.1, "accounting negative");
eq(parseAmount("-$12.00"), -12, "currency + minus");
eq(parseAmount("S$ 3.20"), 3.2, "currency prefix");
eq(parseAmount("12.50-"), -12.5, "trailing minus");
eq(parseAmount("−7.5"), -7.5, "unicode minus");
eq(Number.isNaN(parseAmount("abc")), true, "garbage is NaN");
eq(Number.isNaN(parseAmount("")), true, "empty is NaN");
// dates
eq(parseDate("2026-03-05", "auto"), "2026-03-05", "iso");
eq(parseDate("2026/3/5 14:22:01", "auto"), "2026-03-05", "iso slash with time");
eq(parseDate("05/03/2026", "dmy"), "2026-03-05", "dmy");
eq(parseDate("05/03/2026", "mdy"), "2026-05-03", "mdy");
eq(parseDate("05/03/2026", "auto"), null, "ambiguous needs a format");
eq(parseDate("5 Mar 2026", "auto"), "2026-03-05", "day month-name year");
eq(parseDate("31/02/2026", "dmy"), null, "impossible date rejected");
eq(parseDate("05-03-26", "dmy"), "2026-03-05", "2-digit year");
// csv
eq(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n').rows, [["a", "b"], ["x, y", 'say "hi"']], "quotes + escaped quotes + CRLF");
eq(parseCsv("﻿Date;Amount\n1;2\n").delimiter, ";", "BOM + semicolon sniffing");
eq(parseCsv('a,b\n"multi\nline",2\n').rows[1], ["multi\nline", "2"], "newline inside quotes");
eq(parseCsv("a,b\n\n1,2\n\n").rows.length, 2, "blank lines skipped");
eq(guessMapping(["Transaction Date", "Description", "Debit", "Credit"]), { date: "Transaction Date", name: "Description", debit: "Debit", credit: "Credit" }, "mapping guess (debit/credit)");
eq(guessMapping(["Date", "Payee", "Amount", "Category"]), { date: "Date", name: "Payee", amount: "Amount", category: "Category" }, "mapping guess (amount)");
eq(inferDateFormat(["05/11/2026", "13/11/2026"]), "dmy", "infers day-first from 13/11");
eq(inferDateFormat(["05/11/2026", "11/13/2026"]), "mdy", "infers month-first from 11/13");
eq(inferDateFormat(["05/11/2026", "06/11/2026"]), "auto", "stays ambiguous when no value disambiguates");
eq(inferDateFormat(["13/11/2026", "11/13/2026"]), "auto", "conflicting evidence stays ambiguous");
eq(inferDateFormat(["2026-11-05"]), "auto", "iso needs no inference");
eq(guessMapping(["Date", "Description", "Amount", "Memo"]).notes, "Memo", "memo maps to notes when a description exists");
eq(guessMapping(["Date", "Memo", "Amount"]).name, "Memo", "memo is the description when it is the only text column");
console.log("\nall csv tests passed");
