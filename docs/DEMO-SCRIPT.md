# Demo script: ten minutes, nine steps

The simplified demo uses the real application on a small, readable data set. Nothing is mocked and nothing is switched off in the code: the extra approval steps are settings, and the demo runs with them **off**.

## Before you start

```bash
npm run demo            # loads fresh demo data into mmf_demo, then starts the API and the web app
```

Open **http://127.0.0.1:5173**. Every login uses the same password: **`Demo-2026-Pass`**. Stop with Ctrl+C. Running `npm run demo` again reloads the data from scratch (it drops and recreates `mmf_demo` only; the `mmf` and `mmf_local` databases are never touched). `npm run demo:load` reloads without starting the servers, and `npm run demo:start` starts them on the data already loaded. Docker Desktop must be running.

| Login | Who | Used in step |
|---|---|---|
| `md` | Management | 1, 4 |
| `planthr` | Plant HR, Plant A | 2 |
| `hr` | Corporate HR | 3, 7, 8 |
| `hrhead` | Corporate HR, the second user who approves what `hr` prepares | 8 |
| `employee` | Supervisor at Plant A | 5 |
| `senior` | Senior staff member, at self-assessment | 6 |
| `manager` | Manager (HOD) of the senior staff | 7 |
| `admin` | Admin (IT) | 9 |
| `planthead` | Plant Head, Plant A | not needed on the default settings |

Also loaded, not needed for the script: `senior2` (waiting for the manager), `senior3` (finalised, Outstanding), `planthr-b` and `planthr-c` (who entered Plant B and Plant C's history).

**What is in the data.** Three plants with one scorecard each: Plant A and Plant B are Forge plants on the same template; Plant C is a Machine shop with its own template (Cell Incharge, Setter, Staff). July to September 2026 are locked for all three; **October is open, in draft, for Plant A only**. Plant A is improving, Plant B is declining, Plant C is steady. Three senior staff have goal sheets and monthly results. Bonus is calculated and locked for July to September.

**The default flow.** Shop floor: *Plant HR submits, Corporate HR locks.* Senior staff: *self-assessment, manager, Corporate HR finalises.* Corporate HR can switch on HOD verification, Plant Head approval and a reviewer step under **Approval steps**; the demo does not need them.

---

## 1. Management sees the whole picture

**Login** `md` · **Screen** Management (left menu, *Insight*)

1. Set **Month** to **2026-09**.
2. Point at the three plants: each shows its latest official level scores. Open **Unit trend** and choose a plant to show the quarter and year roll-up.

> "This replaces the plant Excel sheets: one view of every plant, built only from locked, official results. Plant A is climbing, Plant B is slipping, Plant C is steady."

## 2. Plant HR enters October

**Login** `planthr` · **Screen** Monthly entry

1. Set **Month** to **2026-10** and choose **Open PLANT-A**. It is a draft; the people and their levels are already placed.
2. Type the six results: Production output vs plan **95.8**, Rejection **2.4**, Energy per ton forged **390.5**, On-time delivery **94.9**, Unsafe conditions open **1**, Kaizen suggestions implemented **6**.
3. Choose **Submit for review**. The state becomes *Submitted*. Note there is no Lock button: Plant HR cannot lock what they entered.

> "The form checks the figures as they are typed, and the person who enters a month can never be the one who locks it."

## 3. Corporate HR locks the month

**Login** `hr` · **Screen** Plant status

1. Choose **Plant A** and set **Month** to **2026-10**. The unit shows *Submitted*.
2. Choose **Lock all**, then **Lock 1 unit**. The unit becomes *Locked* and the official scores appear.

> "Two steps: Plant HR submits, Corporate HR locks. Once locked, the scores are official and cannot be edited, only reopened with a second person's approval."

## 4. Management sees October appear

**Login** `md` · **Screen** Management

1. Set **Month** to **2026-10**. Plant A now shows *1 of 1 units locked* with scores; Plants B and C show 0 of 1, because October is only open at Plant A.

> "The dashboard updated the moment the month was locked. Nothing is re-typed or re-calculated by hand."

## 5. An employee sees their own results and bonus

**Login** `employee` · **Screen** My results

1. The table lists each month worked at Plant A with the Supervisor level score, now including **Oct 2026**.
2. Scroll to **My bonus**: July ₹3,000.00, August ₹3,300.00, September ₹3,300.00, a total of **₹9,600.00**. (October is not there yet; it appears in step 8.)

> "An employee sees only their own records: their score, the band it fell in, and the exact bonus, in rupees and paise."

## 6. Senior staff: goals and self-assessment

**Login** `senior` · **Screen** My goals

1. Open the goal sheet (FY 2026-27). Show the KRAs, KPIs, weights and targets, and the **Roll-up** of six confirmed months.
2. In **Overall summary of the year**, write a few sentences, choose **Save assessment draft**, then **Submit self-assessment**. It locks once submitted.

> "Senior staff are measured on individual goals agreed at the start of the year; the monthly results roll up to quarters and a year score."

## 7. The manager assesses, Corporate HR finalises

**Login** `manager` · **Screen** Team goals

1. Open the goal sheet. The employee's self-assessment is shown. Write the manager's summary, **Save assessment draft**, then **Submit to Corporate HR**.

**Login** `hr` · **Screen** Appraisal board

2. Open the same goal sheet, choose **Finalise and lock**, then **Yes, finalise**. The final rating and score are shown and the appraisal is locked.

> "Self, manager, HR: three steps. A reviewer step exists, and Corporate HR can switch it on, but this organisation does not need it yet."

## 8. Bonus: Corporate HR calculates, a different person approves

**Login** `hr` · **Screen** Bonus

1. Set **Month** to **2026-10** and choose **Calculate bonus**. A banner says the other plants are not calculated because October is not locked there. Plant A's batch appears as *Calculated*. Choose **Open** to show each person's score, band, base amount, percentage and amount. The dialog says `hr` cannot approve their own batch.

**Login** `hrhead` · **Screen** Bonus

2. Set **Month** to **2026-10**, choose **Open**, then **Approve and lock**. The batch is now *Locked* and **CSV** and **Excel** downloads are available for payroll.

> "Calculating and approving are different people, enforced in the database. After approval nothing can change; a correction is a separate adjustment batch with its own approval. Every amount is a whole number of paise, never a decimal."

## 9. Admin sees who did what, but no scores or pay

**Login** `admin` · **Screen** Audit log

1. Show the sign-ins and account events, and the integrity check that the log's hash chain is intact. Point out the menu: no Bonus, no Management, no Monthly entry.

> "Every action is recorded in a tamper-evident log. IT can see who signed in and who holds which role, but not scores or pay."

---

## If the client asks

- **"Can we add the HOD and Plant Head approvals back?"** Sign in as `hr`, open **Approval steps** (Master data), and switch them on. Nothing is rebuilt; the months already in progress carry on.
- **"What needs two people regardless?"** Activating a template, changing a scorecard target, reopening a locked month, and approving a bonus batch. These are not settings.
- **"Who sees pay?"** Corporate HR (everything), Management (batch totals), and each employee (their own statement). Admin has no pay access.
- **Reset after the demo:** run `npm run demo` again.
