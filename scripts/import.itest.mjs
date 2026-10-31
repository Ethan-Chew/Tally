// Integration test for POST /api/import. WRITES to the database: run it only against a COPY.
//   API_URL=http://localhost:3001 DATABASE_URL=postgres:///maybe_test node scripts/import.itest.mjs
const DB=process.env.DATABASE_URL;
if(!DB){console.error("Set DATABASE_URL to a COPY of your DB");process.exit(2)}
import { execFileSync } from "node:child_process";
const B=process.env.API_URL??"http://localhost:3001"; let cookie="";
const api=async(p,b)=>{const r=await fetch(B+p,{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify(b)});const sc=r.headers.get("set-cookie");if(sc)cookie=sc.split(";")[0];const j=await r.json();return {status:r.status,...j}};
const sql=s=>execFileSync("psql",[DB,"-Atc",s]).toString().trim();
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:fail++;console.log((c?"PASS ":"FAIL ")+m, c?"":"")};
const acc=JSON.parse(await (await fetch(B+"/api/accounts",{headers:{cookie}})).text()).accounts;
const ocbc=acc.find(a=>a.name==="OCBC Account");
const fp=()=>sql("select md5(string_agg(account_id::text||date::text||balance::text,',' order by account_id,date)) from account_balances where account_id<>'"+ocbc.id+"'");
const othersBefore=fp(); const balBefore=Number(sql(`select balance from accounts where id='${ocbc.id}'`));

// bank-style export: negatives are spending, DMY dates, quoted commas, thousands separators, one repeat row, one bad date, one bad amount
const csv=`Date,Description,Amount,Category,Memo
05/11/2026,"Cold Storage, Orchard",-45.60,Food & Drink,weekly
05/11/2026,"Cold Storage, Orchard",-45.60,Food & Drink,second basket
06/11/2026,Salary,"3,200.00",Income,
07/11/2026,Gym,-60,Fitness,
32/11/2026,Bad date,-1,,
08/11/2026,Bad amount,abc,,
`;
let r=await api("/api/import",{csv});
ok(r.headers?.join()==="Date,Description,Amount,Category,Memo"&&r.row_count===6&&r.suggested_mapping.date==="Date"&&r.suggested_mapping.name==="Description"&&r.suggested_mapping.amount==="Amount","step 1 describes file + suggests mapping");
const map={date:"Date",name:"Description",amount:"Amount",category:"Category",notes:"Memo"};
r=await api("/api/import",{csv,account_id:ocbc.id,mapping:map,date_format:"dmy"});
ok(r.status===200&&r.valid===4&&r.error_count===2&&r.to_import===4&&r.imported===0,`dry run: 4 valid, 2 errors, nothing written (${JSON.stringify([r.valid,r.error_count,r.imported])})`);
ok(r.errors.some(e=>e.line===6&&/date/i.test(e.message))&&r.errors.some(e=>e.line===7&&/amount/i.test(e.message)),"errors point at the right line numbers");
ok(r.unknown_categories.join()==="Fitness","unknown category reported");
ok(Math.abs(r.expense-151.2)<1e-6&&Math.abs(r.income-3200)<1e-6,"expense 151.20 / income 3200 (negative = spending)");
ok(sql("select count(*) from account_entries where name='Gym'")==="0","dry run wrote nothing");
r=await api("/api/import",{csv,account_id:ocbc.id,mapping:map,date_format:"auto"});
ok(r.date_format_used==="dmy"&&r.valid===4,"auto infers day-first because one row has day 32 (>12)");
r=await api("/api/import",{csv:"Date,Description,Amount\n05/11/2026,Ambig,-1\n06/11/2026,Ambig2,-2\n",account_id:ocbc.id,mapping:{date:"Date",name:"Description",amount:"Amount"},date_format:"auto"});
ok(r.valid===0&&r.error_count===2&&/pick a date format/.test(r.errors[0].message),"genuinely ambiguous dd/mm is rejected with a hint, not guessed");

r=await api("/api/import",{csv,account_id:ocbc.id,mapping:map,date_format:"dmy",commit:true,create_categories:true});
ok(r.imported===4,"commit imported 4");
ok(sql("select count(*) from account_entries where name like 'Cold Storage%' and date='2026-11-05' and amount=45.6")==="2","identical rows in one file both kept");
ok(sql("select count(*) from categories where name='Fitness' and classification='expense'")==="1","unknown category created as expense");
ok(sql("select c.name from account_entries e join account_transactions t on t.id=e.entryable_id join categories c on c.id=t.category_id where e.name='Salary' and e.date='2026-11-06'")==="Income"&&sql("select amount from account_entries where name='Salary' and date='2026-11-06'")==="-3200.0000","salary matched existing Income category, stored as inflow");
ok(sql("select notes from account_entries where name='Gym'")==="","empty notes stored as NULL"&&sql("select notes from account_entries where notes='weekly'")==="weekly","notes imported");
const expected=balBefore-(-3200)-151.2; // inflow raises, outflows lower... (assets): +3200 -151.2
const bal=Number(sql(`select balance from accounts where id='${ocbc.id}'`));
ok(Math.abs(bal-balBefore)<1e-6,`future-dated rows leave the current balance alone (${balBefore} -> ${bal})`);
const fut=Number(sql(`select balance from account_balances where account_id='${ocbc.id}' and date='2026-11-07'`));
ok(Math.abs(fut-(balBefore+3200-151.2))<1e-6,`...but the balance series reflects them on their dates (${fut})`);
ok(fp()===othersBefore,"other accounts' balances untouched");
const dbl=Number(sql(`select balance from account_balances where account_id='${ocbc.id}' and date=current_date`));
ok(Math.abs(dbl-bal)<1e-6,"daily balance series matches account balance");

r=await api("/api/import",{csv,account_id:ocbc.id,mapping:map,date_format:"dmy",commit:true});
ok(r.status===400,"re-import of the same file -> nothing to import");
r=await api("/api/import",{csv,account_id:ocbc.id,mapping:map,date_format:"dmy"});
ok(r.duplicates===4&&r.to_import===0,"re-import detects all 4 as duplicates");
r=await api("/api/import",{csv,account_id:ocbc.id,mapping:map,date_format:"dmy",skip_duplicates:false});
ok(r.to_import===4,"skip_duplicates=false overrides");

// debit/credit columns, semicolon, positive=expense
const csv2="Booking Date;Details;Withdrawal;Deposit\n2026-11-10;Taxi;12,50;\n2026-11-11;Refund;;5,00\n";
r=await api("/api/import",{csv:csv2,account_id:ocbc.id,mapping:{date:"Booking Date",name:"Details",debit:"Withdrawal",credit:"Deposit"},commit:true});
ok(r.imported===2&&sql("select amount from account_entries where name='Taxi'")==="12.5000"&&sql("select amount from account_entries where name='Refund'")==="-5.0000","debit/credit columns + semicolon + decimal comma");
// positive-is-expense convention
const csv3="d,n,a\n2026-11-12,Coffee,3.50\n";
r=await api("/api/import",{csv:csv3,account_id:ocbc.id,mapping:{date:"d",name:"n",amount:"a"},expense_sign:"positive",commit:true});
ok(r.imported===1&&sql("select amount from account_entries where name='Coffee' and date='2026-11-12'")==="3.5000","expense_sign=positive");

// a row dated today does move the current balance
r=await api("/api/import",{csv:"d,n,a\n"+new Date().toLocaleDateString("en-CA")+",ITEST today,-10\n",account_id:ocbc.id,mapping:{date:"d",name:"n",amount:"a"},commit:true});
ok(r.imported===1&&Math.abs(Number(sql(`select balance from accounts where id='${ocbc.id}'`))-(balBefore-10))<1e-6,"today-dated row lowers current balance");
// validation / security
r=await api("/api/import",{csv,account_id:ocbc.id,mapping:{...map,date:"Nope"}}); ok(r.status===400,"unknown column -> 400");
r=await api("/api/import",{csv,mapping:map}); ok(r.status===400,"no account -> 400");
r=await api("/api/import",{csv,account_id:"00000000-0000-4000-8000-000000000000",mapping:map}); ok(r.status===404,"foreign/unknown account -> 404");
r=await api("/api/import",{csv:"only,header\n"}); ok(r.status===400,"header only -> 400");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
