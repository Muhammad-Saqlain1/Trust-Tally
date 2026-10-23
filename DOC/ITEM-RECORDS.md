# Item records and monthly summaries

Read against the original ten-page [PRD](PRD.pdf), with the owner's requested kg/g/liter columns added to the existing HTML, CSS, JavaScript, Express and MySQL application.

## Delivered behavior

- Customers see Date, Item Name, Weight (kg), Weight (g), Liter (li), Pieces, and Total Cost in their purchased item history. Every quantity appears in exactly one measurement column. Original decimals, units, costs, bill links and return/cancellation labels remain intact.
- Shopkeepers enter quantities using the catalogue item's saved unit. Both bill entry interfaces label quantity and price with that unit, for example `Quantity (g)` and `Rs. per g`. The server calculates and stores the authoritative bill total.
- Daily reports use the same measurement columns, with the date, customer, unit price, original total cost, corrections, allocated payments and remaining amount.
- Both monthly report screens now display their item summary, including original quantities and costs, returns/cancellations and net quantities/costs, alongside the monthly balance statement. The statement preserves previous balance + bills - confirmed payments - corrections = closing balance.
- Customer accounts cannot create bills, change catalogue entries or record cash payments. Their item history and reports are scoped to their authenticated shop and customer. Customer daily reports display their own corrections and do not query or expose shop expenses.
- Cancelled bills retain their original items and costs. Daily and monthly item reports fully offset cancelled quantities and costs, including when a partial return came before the cancellation.
- Return and cancellation notifications now include the customer ID, fixing a MySQL binding error that previously rolled those transactions back.
- The existing grams migration `007_item_measurements` was applied to the connected database. It appends `g` without changing existing enum positions or saved quantities. The service worker cache was updated for the new interface.

## Verification

`npm.cmd run check` validates source syntax and PWA resources. `npm.cmd test` covers permissions, exact unit columns, saved costs, customer scoping, allocation, monthly balances and corrections. MySQL integration tests require `TEST_DATABASE_URL`.

The report integration test was also run against the connected MySQL database using a separate test shop inside a transaction. It verified real kg/g/L billing, historical costs after a catalogue price change, partial returns, cancellation without double counting, customer notifications, customer report privacy and daily/monthly balances. All financial test fixtures were rolled back and verified absent afterward.

An isolated Edge profile with synthetic API fixtures verified the customer item columns and original costs, daily reports for both roles, both monthly item summaries, unit-specific bill labels, a three-item bill total of Rs. 3,440 and its save payload, empty states, and layouts at 1440, 768, 390 and 320 pixels. These browser fixtures do not claim live authentication or provider integration.

Review captures use synthetic data: [customer items on desktop](previews/item-records-desktop.png), [customer items on mobile](previews/item-records-mobile.png), and [monthly item summary](previews/monthly-item-summary.png). Wide tables scroll horizontally on smaller screens.

The remaining PRD phases documented in [IMPLEMENTATION.md](IMPLEMENTATION.md) still apply, including online proof/approval services, provider messaging, chat, scheduled closing/backups, exports, Urdu and gateway setup. This delivery does not represent the entire PRD as production-complete.
