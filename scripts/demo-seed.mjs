import { execFileSync } from "node:child_process";
// Fills an EMPTY database (Maybe schema, no rows) with a made-up household so the app can be shown or screenshotted without real data.
// It WRITES, so point it at a throwaway database:
//   createdb maybe_demo && pg_dump -s --no-owner "$YOUR_DB_URL" | psql maybe_demo     # copy the schema only
//   DATABASE_URL=postgres:///maybe_demo PORT=3003 npm start &                           # the API the script talks to
//   API_URL=http://localhost:3003 DATABASE_URL=postgres:///maybe_demo node scripts/demo-seed.mjs
// Twelve months of history ending today, in SGD. The numbers come from a fixed pseudo-random sequence, so every run is the same.
const B = process.env.API_URL ?? "http://localhost:3003";
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL to the throwaway database"); process.exit(2); }
const sql = (s) => execFileSync("psql", [process.env.DATABASE_URL, "-Atqc", s]).toString().trim();
const api = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const iso = (d) => d.toLocaleDateString("en-CA");

const today = new Date(); today.setHours(0, 0, 0, 0);
const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);

if (sql("select count(*) from users") !== "0") { console.error("This database already has data; refusing to add more."); process.exit(1); }
sql("insert into families (name, currency, locale, country, date_format, created_at, updated_at) values ('Demo household', 'SGD', 'en', 'SG', '%d/%m/%Y', now(), now())");
sql("insert into users (family_id, first_name, last_name, email, role, active, created_at, updated_at) select id, 'Alex', 'Tan', 'demo@example.com', 'admin', true, now(), now() from families");

// categories: [name, colour, icon, children]
const spend = [
  ["Housing", "#6471eb", "home", [["Rent", "Rent"], ["Utilities", "Utilities"]]],
  ["Food & Drink", "#e99537", "utensils", [["Groceries", "Groceries"], ["Dining out", "Dining out"], ["Coffee", "Coffee"]]],
  ["Transport", "#4da568", "bus", []],
  ["Shopping", "#df4e92", "shopping-bag", []],
  ["Entertainment", "#8b5cf6", "film", [["Subscriptions", "Subscriptions"]]],
  ["Health", "#0ea5e9", "heart-pulse", [["Gym", "Gym"], ["Insurance", "Insurance"]]],
  ["Travel", "#14b8a6", "plane", []],
];
const earn = [["Salary", "#10b981", "briefcase"], ["Freelance", "#84cc16", "laptop"], ["Dividends", "#22c55e", "coins"]];
const cat = {};
for (const [name, color, icon, kids] of spend) {
  cat[name] = (await api("POST", "/api/categories", { name, color, lucide_icon: icon, classification: "expense" })).id;
  for (const [kid] of kids) cat[kid] = (await api("POST", "/api/categories", { name: kid, color, lucide_icon: icon, classification: "expense", parent_id: cat[name] })).id;
}
for (const [name, color, icon] of earn) cat[name] = (await api("POST", "/api/categories", { name, color, lucide_icon: icon, classification: "income" })).id;

const open = iso(start);
const acct = async (name, type, balance) => (await api("POST", "/api/accounts", { name, type, balance, date: open })).id;
const checking = await acct("Everyday Checking", "Depository", 4200);
const savings = await acct("Rainy Day Savings", "Depository", 12000);
const card = await acct("Visa Rewards", "CreditCard", 0);
const broker = await acct("Brokerage", "Investment", 18400);
const loan = await acct("Car Loan", "Loan", 9600);

const post = (account_id, date, name, amount, type, category, merchant) =>
  api("POST", "/api/entries", { account_id, date: iso(date), name, amount, type, category_id: cat[category], merchant_name: merchant ?? name });

for (let m = new Date(start); m <= today; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
  const day = (n) => new Date(m.getFullYear(), m.getMonth(), n);
  const live = (d) => d <= today;
  const put = async (account, d, name, amount, type, category, merchant) => { if (live(d)) await post(account, d, name, amount, type, category, merchant); };
  const quarter = m.getMonth() % 3 === 0;

  // fixed bills
  await put(checking, day(1), "Rent", 1450, "expense", "Rent", "Landlord");
  await put(checking, day(3), "Gym membership", 39, "expense", "Gym", "FitHub");
  await put(checking, day(5), "Electricity & water", between(78, 112), "expense", "Utilities", "City Utilities");
  await put(checking, day(8), "Home fibre", 45.9, "expense", "Utilities", "Starlink Fibre");
  await put(card, day(12), "Streaming", 15.49, "expense", "Subscriptions", "Streamflix");
  await put(card, day(15), "Music", 10.99, "expense", "Subscriptions", "Tunely");
  await put(checking, day(20), "Mobile plan", 25, "expense", "Utilities", "Telco One");
  if (quarter) await put(checking, day(10), "Insurance premium", 210, "expense", "Insurance", "Shield Insurance");
  // income
  await put(checking, day(25), "Salary", 4800, "income", "Salary", "Northwind Pte Ltd");
  if (rnd() < 0.4) await put(checking, day(Math.floor(between(8, 22))), "Freelance project", between(300, 900), "income", "Freelance", "Side client");
  if (quarter) await put(broker, day(14), "Dividend", between(60, 95), "income", "Dividends", "Index fund");
  // everyday spending
  for (let i = 0; i < 4; i++) await put(checking, day(2 + i * 7 + Math.floor(rnd() * 3)), "Groceries", between(38, 96), "expense", "Groceries", pick(["FairPrice", "Cold Storage", "Sheng Siong"]));
  for (let i = 0; i < 8; i++) await put(card, day(Math.floor(between(1, 28))), "Dinner", between(12, 62), "expense", "Dining out", pick(["Hawker Centre", "Din Tai Fung", "Pasta House", "Sushi Bar", "Ramen Ya"]));
  for (let i = 0; i < 10; i++) await put(card, day(Math.floor(between(1, 28))), "Coffee", between(4.2, 7.5), "expense", "Coffee", pick(["Kopi Corner", "Beanstalk", "Daily Grind"]));
  for (let i = 0; i < 9; i++) await put(checking, day(Math.floor(between(1, 28))), "Ride", between(3, 24), "expense", "Transport", pick(["MRT", "Grab", "Bus"]));
  for (let i = 0; i < 2 + Math.floor(rnd() * 2); i++) await put(card, day(Math.floor(between(1, 28))), "Shopping", between(25, 160), "expense", "Shopping", pick(["Uniqlo", "Amazon", "IKEA", "Decathlon"]));
  if (rnd() < 0.6) await put(card, day(Math.floor(between(1, 28))), "Cinema", between(14, 36), "expense", "Entertainment", "Golden Screen");
  if (rnd() < 0.3) await put(checking, day(Math.floor(between(1, 28))), "Clinic", between(35, 90), "expense", "Health", "Family Clinic");
  if (m.getMonth() === 7) await put(card, day(11), "Flights to Tokyo", 640, "expense", "Travel", "Skyways");
  // moving money: savings top-up, card payoff, loan repayment (transfers are left out of spending)
  if (live(day(26))) {
    await api("POST", "/api/transfers", { from_account_id: checking, to_account_id: savings, amount: 600, date: iso(day(26)) });
    const owed = (await api("GET", "/api/accounts/" + card)).account.balance;
    if (owed > 0) await api("POST", "/api/transfers", { from_account_id: checking, to_account_id: card, amount: Math.round(owed * 100) / 100, date: iso(day(27)) });
    await api("POST", "/api/transfers", { from_account_id: checking, to_account_id: loan, amount: 320, date: iso(day(28)) });
  }
  // the portfolio is valued by hand once a month
  const month = (m.getFullYear() - start.getFullYear()) * 12 + m.getMonth() - start.getMonth();
  if (live(day(28))) await api("POST", `/api/accounts/${broker}/valuations`, { date: iso(day(28)), amount: Math.round(18400 * Math.pow(1.011, month) + between(-300, 450)) });
}

// this month's and last month's budgets
const budget = { Rent: 1450, Utilities: 220, Groceries: 380, "Dining out": 320, Coffee: 70, Transport: 120, Shopping: 220, Subscriptions: 30, Gym: 39, Insurance: 210, Entertainment: 60, Health: 50, Travel: 150 };
for (const month of [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)).slice(0, 7), iso(today).slice(0, 7)]) {
  await api("PUT", `/api/budgets/${month}`, {
    budgeted_spending: 3400, expected_income: 5200,
    categories: Object.entries(budget).map(([name, budgeted_spending]) => ({ category_id: cat[name], budgeted_spending })),
  });
}
console.log("Seeded:", sql("select count(*) from account_entries"), "entries across 5 accounts");
