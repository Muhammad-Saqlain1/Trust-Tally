# HTML pages from the PRD

All screens use plain HTML, shared CSS, and plain JavaScript. Each file contains a complete document, its own main content, and navigation. There are no placeholder redirect pages and no frontend framework.

Review captures using synthetic QA data: [customer Pay on mobile](previews/customer-pay-mobile.png), [staff permissions](previews/staff-permissions-desktop.png), and [customer Chat](previews/customer-chat-desktop.png).

Run `npm.cmd start` and open a path below at `http://127.0.0.1:3000`. The full layouts can be reviewed before database setup; account data still requires a valid sign-in. The original application remains available at `/`.

| Shopkeeper screen | HTML file |
| --- | --- |
| Login | `public/shopkeeper/login.html` |
| Dashboard | `public/shopkeeper/dashboard.html` |
| Customers | `public/shopkeeper/customers.html` |
| Customer Ledger | `public/shopkeeper/customer-ledger.html` |
| New Bill | `public/shopkeeper/new-bill.html` |
| Bills | `public/shopkeeper/bills.html` |
| Payments and Approvals | `public/shopkeeper/payments.html` |
| Daily Report | `public/shopkeeper/daily-report.html` |
| Monthly Reports | `public/shopkeeper/monthly-reports.html` |
| Expenses | `public/shopkeeper/expenses.html` |
| Suppliers | `public/shopkeeper/suppliers.html` |
| Item Catalogue | `public/shopkeeper/item-catalogue.html` |
| Chat | `public/shopkeeper/chat.html` |
| Account Details | `public/shopkeeper/account-details.html` |
| Staff | `public/shopkeeper/staff.html` |
| Audit Log | `public/shopkeeper/audit-log.html` |
| Profile and Settings | `public/shopkeeper/profile.html` |

| Customer screen | HTML file |
| --- | --- |
| Login | `public/customer/login.html` |
| Dashboard | `public/customer/dashboard.html` |
| My Bills | `public/customer/my-bills.html` |
| Item Catalogue (purchased quantities) | `public/customer/item-catalogue.html` |
| Pay | `public/customer/pay.html` |
| My Payments | `public/customer/my-payments.html` |
| Monthly Statements | `public/customer/monthly-statements.html` |
| Chat | `public/customer/chat.html` |
| Shopkeeper Contact | `public/customer/shopkeeper-contact.html` |
| Profile | `public/customer/profile.html` |
| Daily Report (feature C09) | `public/customer/daily-report.html` |
| Monthly Report (feature C09) | `public/customer/monthly-report.html` |

Shared authentication pages: `public/register.html`, `public/recover.html`, and `public/accept-invite.html`. Existing invitation URLs at `/?invite=…` continue working. The standalone acceptance page uses `/accept-invite.html?invite=…`.

Forms and dialogs cover customer consent, item pictures, cash receipt, payment proof, approval/rejection, returns/cancellations, item disputes, expenses, supplier transactions, staff permissions, account details, and profile settings. All pages share responsive navigation and a mobile drawer. Bill and payment details support browser receipt printing. Filters, search, copy buttons, attachment previews and bill calculations run in the browser.

The API is connected for authentication, owner-managed staff accounts and permissions, customer records, catalogue items, bills, item returns and bill cancellations, cash receipts, ledgers, dashboard totals, daily/monthly reports, customer statements, audit history, profile/account details and customer OK confirmations. Staff verify their phone and set a PIN through recovery before signing in. Expense entry, supplier operations, chat, online proof/approvals, disputes, translation, backup/export and gateway operations have frontend screens and forms, but their later-phase backend services remain unfinished. Those forms explicitly report that nothing was saved; they do not fake a successful operation or financial change.

All 32 HTML documents are included in the PWA shell cache. Private API responses are never cached. Offline financial entry requires a page already authenticated online; reconnect before navigating away to another standalone page when working offline. The original app at `/` retains its existing single-page offline workflow.

The customer Item Catalogue lists only the signed-in customer's purchased items, using the original quantities and units saved on each bill. It supports kg, g, L and existing piece items, bill links, return/cancellation labels, and pagination through older purchases. Apply database migrations before recording items in grams.

Purchased items and daily reports now show separate kg, g, liter and pieces columns with the date and original total cost. Both monthly report pages include the item summary as well as the balance statement. Customers see their own corrections in daily report totals; shop expenses appear only in authorized shopkeeper/staff reports. See [the item records delivery](ITEM-RECORDS.md) for validation and review captures.

The source templates are in `scripts/build-pages.js`. Run `npm.cmd run pages:build` to regenerate the tracked HTML files and `public/page-catalog.json`. Edit those templates when changing shared or page-specific markup. Page behavior is in `public/pages.js`; additional responsive styling is in `public/pages.css`.
