# PRD implementation record

The original PRD is unchanged. This delivery starts with its Phase 1 and the specified HTML/CSS/JavaScript, Express.js and SQL stack. MySQL is the engine named in PRD section 15. Express is specified by the user, and the user approved `mysql2` during implementation.

The subsequent [item records delivery](ITEM-RECORDS.md) adds the owner's requested Date, Item Name, kg, g, liter and Total Cost columns, connects monthly item summaries on both report pages, and fixes customer expense exposure and cancellation reporting. Targeted MySQL verification covered actual measured bills and corrections inside a transaction that was rolled back afterward; the optional integration tests remain available for a separate test database.

The subsequent HTML delivery adds every PRD screen as a complete standalone document: **17 shopkeeper pages, 11 customer pages (including C09 daily/monthly reports), and 3 shared authentication pages**. See [HTML-PAGES.md](HTML-PAGES.md) for the paths and frontend/backend coverage. Existing Phase 1 services are connected; later-phase forms report explicitly that the operation is unavailable and nothing has been saved. HTML screen completion does not mean those backend features are complete.

| PRD acceptance criterion | Current coverage |
| --- | --- |
| 1. Maximum 500 customers | Backend count check and atomic database capacity trigger; live MySQL check remains environment-dependent. |
| 2. Customer sees only own data | Session-derived identity, tenant-filtered queries and role restrictions. HTTP access tests pass. |
| 3. Itemized bill, quantities, paid/pending | Implemented, including original item/price snapshots and linked paid-now cash receipt. |
| Item return and bill cancellation | Owner can record partial item returns or cancel the remainder of a bill with a reason. Original bill, correction, notification and audit are retained. An excess over unpaid balance becomes a carried-forward credit. |
| 4. Per-item OK or Dispute | OK implemented. Dispute dialog is present; its Phase 3 backend remains. |
| 5. Cash reduces balance and sends message | Transactional receipt, allocation and in-app account update implemented. External message delivery needs a provider. |
| 6. Online/QR requires shopkeeper confirmation | No unconfirmed payment enters balance calculations. Proof, approval, and QR setup interfaces are present; their later-phase backend integrations remain. |
| 7. Closed month carries forward | Monthly reports and customer statements calculate previous balance, bills, confirmed payments, returns and closing balance. Past months are saved as immutable summaries, and new backdated bills/payments are rejected once that customer month is closed. Automatic scheduled closing remains deployment work. |
| 8. Oldest balance paid first | Opening debt then bills by business date and ID. Domain tests cover the PRD example. |
| Cash payments and customer ledger | Cash is approved immediately, audited, announced to the customer, and allocated to opening debt then oldest bills. Payment receipts show the allocation; the full ledger includes the opening balance, bills, confirmed payments, and returns. |
| 9. Owner-only audit with changes | Transactional old/new audit entries and append-only triggers; customer/staff access denied. |
| Staff accounts and permissions | Shopkeeper provisions staff with selected permissions and a temporary PIN. Permissions are checked per request, and deactivation revokes sessions. |
| 10. Offline bills/payments without duplicate sync | Shared PWA shell, encrypted IndexedDB outbox and idempotent SQL transactions. Browser test verifies queue and reconnection. Offline creation needs an already-authenticated open tab. |
| 11. PDF through WhatsApp/SMS | Remains in Phase 2, subject to provider and export-library approval. |
| 12. Red/white and limited blinking | Red/white responsive UI. Reduced-motion override included; no unrelated state blinks. Approved 8K images remain an owner input. |

Local automated checks validate JavaScript, install resources, financial examples, authentication primitives, and HTTP access boundaries. Desktop/mobile checks ran in an isolated headless Edge profile using synthetic API fixtures; these verify frontend behavior and do not claim live database integration. The opt-in MySQL integration suite requires `TEST_DATABASE_URL` and a disposable migrated database.

The README describes setup, current capabilities and limitations, and the remaining phases. Live provider delivery, financial database integration, the owner’s visual review, production performance testing, backups, gateway access and pilot/launch are not represented as complete.

HTML delivery validation: all 31 pages return successfully; navigation and shared asset links resolve; every page was checked at 1440px and 390px widths in an isolated browser. Browser fixtures verified bill calculations/submission, ledger loading, item OK, dispute dialog population, payment filters, attachment preview, mobile drawer, role mismatch handling, and caching of public HTML without private API responses. Automated suite: 19 passed; one MySQL integration test skipped without a configured database.
