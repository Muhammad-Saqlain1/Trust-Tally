# Trust-Tally

Core implementation of [DOC/PRD.pdf](DOC/PRD.pdf), covering the approved UI, authentication, user roles, customers, billing, corrections, cash payments, ledgers, dashboards, reports and monthly statements. The responsive website and installable mobile app share the same **HTML, CSS, and plain JavaScript**. The server uses **Node.js / Express.js**, with **MySQL 8** as the SQL database. Express and the owner-approved `mysql2` driver are the only direct runtime dependencies.

Review captures: [login](DOC/previews/login-desktop.png), [desktop dashboard](DOC/previews/dashboard-desktop.png), and [mobile bill](DOC/previews/bill-mobile.png). Dashboard and bill captures use isolated QA fixtures; the real application starts without sample financial records. See [the PRD coverage record](DOC/IMPLEMENTATION.md) for implemented and remaining criteria.

**All PRD HTML screens are now available:** [page list and frontend coverage](DOC/HTML-PAGES.md). Start with `/shopkeeper/login.html` or `/customer/login.html`. This adds the full frontend page set while later-phase backend services remain pending.

## Run locally

Install Node.js 22.13 or newer and MySQL 8.0.16 or newer. Create an empty database and dedicated database user using your database administrator account. Use `utf8mb4` for the database. Do not use a root account for the running application.

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Set `DATABASE_URL` in `.env` to your database connection string. URL-encode special characters in credentials. The migration account needs permission to create tables, foreign keys and triggers.

```powershell
npm.cmd run db:migrate
npm.cmd start
```

For an existing installation, rerun `npm.cmd run db:migrate` before using grams or packaged-bottle prices. Migration `007_item_measurements` adds `g`; migration `009_bottle_prices` adds bottle size, count, and final-price snapshots while preserving existing measured items and bills.

Open **http://127.0.0.1:3000**. The server can show the login interface before the database is configured; financial operations require a migrated MySQL database. The schema migration is recorded with a checksum and will not rerun automatically. MySQL DDL is not transactional: investigate a failed migration before retrying against a partially created database.

## Phone verification and consent

Customer, shopkeeper, and staff authentication uses a registered phone number and six-digit PIN. Shop registration creates the PIN directly, and customers create a PIN through their private invitation link.

1. Register the shop with SMS phone verification and a six-digit PIN.
2. Complete the shop profile and account details.
3. Add catalogue items and customers.
4. The customer creation dialog provides a seven-day private invitation link. Open it in a separate browser profile, enter the invited phone number, accept consent, and set a PIN.
5. Create bills and receive cash after consent is accepted. A zero credit limit requires a reason for any positive credit balance.

The shopkeeper creates staff accounts on the Staff screen, assigns permissions, and sets a temporary six-digit PIN. The staff member signs in through the Shopkeeper / Staff Login screen. The server checks permissions on every request; disabling a staff account also clears its sessions.

Customer invitation links must be shared privately. The current account model associates each phone identity with one shop. Supporting the same phone in several shop accounts requires a shop-selection design.

## Implemented in this delivery

- Shopkeeper registration, PIN login, private customer invitations, and eight-hour server-side sessions.
- Owner-managed staff accounts with temporary PIN setup, per-action permissions, immediate permission changes, and session revocation on deactivation.
- Shop profile and bank/Easypaisa/JazzCash account details.
- Customer creation, editing, deactivation, acceptance of an invitation, auto IDs, opening balances, and credit limits.
- Backend and database enforcement of the 500-customer limit; inactive and invited customers count toward capacity.
- Item catalogue with editable measured-unit rates and packaged-bottle variants. Each bottle size keeps its own original final price; for example, a 1.5 L bottle at Rs. 170 and a 2 L bottle at Rs. 210 are charged directly without using or adding a per-liter rate.
- Bills with kg/g/L/piece quantities, item snapshots, paid-now cash payments, and totals calculated in integer paisa.
- Customer Item Catalogue at `/customer/item-catalogue.html`: Date, Item Name, Weight (kg), Weight (g), Liter (L), Pieces, and Total Cost, with original bill links, return/cancellation labels, and access to older purchases. Quantities and costs come from the saved bill, even after catalogue prices change. The server scopes these records to the signed-in customer.
- The customer catalogue has **New** and **Old** views. New shows the current month's bill items; Old shows items from previous months. Both include the saved item name, exact quantity and unit, amount, and date, and remain scoped to the signed-in customer.
- Item returns and bill cancellations with a required reason, preserved original bill, customer notification, audit entry, and idempotent retry. If a correction exceeds the unpaid balance, the remainder carries forward as customer credit.
- Cash receipt with oldest-first allocation, including opening debt; overpayments are rejected.
- Owner/customer dashboards, latest bills and payments, item confirmation, and paginated complete customer ledgers. Customer bill lists show each item name and exact quantity directly.
- Customer catalogues work in both the original app and standalone pages, with quantities visible on phones, manual refresh, and automatic refresh when the customer returns or leaves the page open. Online app assets refresh from the server so old cached code does not hide these updates.
- Shopkeeper and customer dashboard totals, daily item reports, monthly customer reports, customer statements, overdue balances after the 10th, and immutable closed-month summaries carried into later periods.
- Daily reports use separate measurement columns and show original costs, corrections, payments, and the remaining amount. Both monthly report pages include an item summary with billed, returned/cancelled, and net quantities and costs. Customer reports never query or expose shop expenses. See [item record delivery details](DOC/ITEM-RECORDS.md).
- Owner-only audit history with old/new values; database triggers block changes to audit entries and deletion of bills, payments, and returns.
- Separate customer views and tenant filtering from the authenticated server session, plus composite foreign keys for tenant relationships.
- A red-and-white interface, accessible labels, mobile drawer, responsive tables, install manifest, icons, and service worker.
- Encrypted browser outbox for offline bills and cash payments with automatic retries and transaction identifiers to prevent duplicates. Original business dates survive sync.

## Offline and installation

The shopkeeper Item Catalogue now has an **Add item to customer’s khata** form. Enter the customer ID or name, item name, quantity, kg/g/L unit, and rate. For packaged liquids, choose bottle pricing, enter the bottle size and count, and save the original final price for that exact size. A saved 1.5 L bottle at Rs. 170 always adds Rs. 170 per bottle; a separate 2 L variant can be Rs. 210. A loose-liquid rate such as Rs. 130/L is never applied to either bottle. Saving records the credit immediately and shows a numbered list of that customer’s items for the current month.

Khata item saving and chat delivery are separate operations. The bill and balance commit first. The server then inserts an idempotent chat update linked to that bill. If chat storage is unavailable, the financial entry remains saved and the shopkeeper sees **Saved, chat not connected**; restart the backend or rollback-only QA server after restoring its chat/database connection, then retry the connection check.

**New Bill** now needs only the customer ID or name. It loads every saved item for that customer’s current month, including quantities, units, rates, item amounts, returns/cancellations, and the monthly total. **Create bill** saves a monthly summary; it does not charge those items again or close the month. Repeating the action without changed records returns the same saved bill. Later changes produce a new saved version while preserving earlier bills. Shopkeepers and customers can open the saved summaries under **Bills / My Bills → Monthly bills**.

Apply the monthly-bill table, bottle pricing fields, and idempotent khata chat delivery to an existing database with `npm.cmd run db:migrate -- --only=008_monthly_bills`, `npm.cmd run db:migrate -- --only=009_bottle_prices`, and `npm.cmd run db:migrate -- --only=010_khata_chat_delivery`. Fresh databases apply them with the normal migration command. Khata entries use the existing encrypted outbox when a signed-in page loses its connection, preserving the entry date and retry identifier. Queued items enter the confirmed monthly list after syncing. Monthly bill creation requires a connection to collect the complete month’s records.

Visit the application online before installing it. Use the browser's install option on Android/desktop or **Share â†’ Add to Home Screen** on iOS. Where the browser exposes its install prompt, the profile screen also offers installation. A PWA uses the same frontend source; this delivery is not a store-published native app.

The service worker caches the application shell only. It never caches API responses, login sessions, or customer records. Bills and cash payments can be created offline **within a tab already signed in online**. A reload while offline requires reconnection to authenticate again; queued requests persist and sync after the same owner signs back in. Opening balances and displayed totals are the last server-confirmed values until sync.

Queued financial payloads are encrypted with AES-GCM and a non-extractable, origin-scoped browser key. Queues are separated by owner and shop. A request that loses its response can be safely replayed using the same identifier. A server conflict pauses the queue and displays the reason; entries are retained. Reconnect and resolve the cause (for example, reactivate a customer or unavailable item), then retry. Clearing browser site data removes unsynced local entries; production mobile use needs durable device storage practices and pilot testing.

## Remaining PRD phases and owner inputs

| PRD phase | Status / remaining work |
| --- | --- |
| Phase 1: Core | Application implemented; real MySQL verification and live phone/invite delivery need environment/provider setup. |
| Phase 2: Payments and Communication | Manual online proof/approval, chat, external update delivery, automatic month-close scheduling, reminder delivery and PDF sharing remain. On-demand monthly statements and immutable closed-month summaries are implemented. |
| Phase 3: Control and Reports | Expense entry, disputes, scheduled backup/export, Urdu, receipt layout, and supplier khata remain. Daily/monthly financial reports, item returns, bill cancellation, staff permissions and credit-limit checks are implemented. |
| Phase 4: Gateway and Launch | Raast/Easypaisa/JazzCash provider verification and QR flows, full integration testing, pilot and deployment remain. |

The complete PRD entity schema is included to support later phases, but tables alone do not constitute implemented features. Online payment submission is not exposed in this release; an unconfirmed payment cannot change any balance. No gateway or paid service has been added. Export libraries require owner approval before use.

Owner-provided or approved 8K photo masters, a logo/photo upload policy, messaging credentials, gateway merchant access, phone-change verification rules and printer requirements are still needed. The current interface uses first-party vector artwork and system fonts; it does not claim to include the PRD's 8K photo assets. Scope is the PRD; no React, Vue, Next.js, native language, or separate mobile codebase has been added.

## Verification

```powershell
npm.cmd run check
npm.cmd test
```

Tests cover the PRD's numerical examples, decimal rounding, oldest-first allocations, business dates, PIN hashing, access restrictions, request-origin protection, response secrecy and application/PWA resources. HTTP tests use an injected database boundary; they do not substitute for MySQL integration testing.

To run the optional integration test, point `TEST_DATABASE_URL` to a **separate, already migrated, disposable MySQL database**, then run `npm.cmd test`. It exercises real transactions, idempotent replays, opening-debt allocation, payment validation, bill corrections and audit/no-delete triggers. Test fixtures remain in that database because financial history is deliberately immutable.

The additional `mysql-reports.integration.test.js` checks original kg/g/L quantities and costs, price changes, partial returns followed by cancellation, daily/monthly totals, and customer expense privacy through real SQL. Its isolated fixtures are always rolled back, including on a failed assertion.

## Production deployment

Use a Node-capable host, the Express process and a MySQL database. Sites hosting uses a different runtime and has not been used to replace the specified backend. Keep the database account permissions limited; use a separate migration account, give the application `SELECT, INSERT` only on `audit_logs`, and avoid financial-table `DELETE` grants. Serve behind HTTPS, set `NODE_ENV=production`, set `COOKIE_SECURE=true`, and set `TRUST_PROXY=true` only behind a trusted single reverse proxy. The development server binds to loopback by default; use `HOST=0.0.0.0` only when the deployment needs it.

Production operations still require encrypted database storage and backups, tested restores, five-year retention, monitoring and load testing against the PRD's expected volume. No five-year reliability or performance target is claimed from a local implementation. The current authentication rate limit is per process; a multi-process deployment needs a shared limiter before launch.
