# Sandbox evidence

Request and response records from real calls to the PayPal sandbox (`api-m.sandbox.paypal.com`), written by a spike script on 2026-11-11 (UTC). Access tokens are never stored; `links` arrays are dropped; the test card number is redacted.

| File | What it shows |
|---|---|
| `wallet_1_create_order_authorize.json` | `POST /v2/checkout/orders` with `intent: AUTHORIZE` for the PayPal wallet flow; PayPal answers `PAYER_ACTION_REQUIRED` |
| `wallet_2_authorize_after_buyer_approval.json`, `wallet_3_partial_capture_final.json`, `wallet_4_get_authorization_after_capture.json` | The same wallet order after a sandbox buyer approved it in a browser: authorization `CREATED` for 19.75 USD, final capture of 11.77 USD, authorization `CAPTURED` |
| `app_e2e_1_get_order.json` to `app_e2e_4_get_refund.json` | PayPal's own records of one order driven through the SwapSafe screens by `e2e/flow.mjs` (JS SDK v6 approval popup, pick list, approval, capture of 11.77 of 19.75 USD, refund of 2.99 USD through the Agent Toolkit) |
| `webhook_verify_hosted_e2e.json` | One order driven through the hosted deployment (https://swapsafe.vercel.app) by `e2e/flow.mjs --swap`: the three webhooks PayPal delivered (`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`), each with `verification_status: SUCCESS` from verify-webhook-signature, plus the order's ledger and assistant timeline |
| `webhook_verify_hosted_void.json` | An order on the hosted deployment where nothing could be packed (`e2e/flow.mjs --void`): the authorization was voided and PayPal's `PAYMENT.AUTHORIZATION.VOIDED` webhook was verified |
| `app_e2e_swap_run.json` | The same flow on a local build, with the swap accepted by the shopper |
| `card_1_create_order_authorize_card.json` | An AUTHORIZE order paid with a sandbox test card: authorization `CREATED` for 19.75 USD |
| `card_2_partial_capture_final.json` | `POST /v2/payments/authorizations/{id}/capture` for 11.77 USD with `final_capture: true`: `COMPLETED` |
| `card_2b_same_request_id_retry.json` | The same call repeated with the same `PayPal-Request-Id`: PayPal returns the same capture id, no second capture |
| `card_3_get_authorization_after_capture.json` | The authorization now reads `CAPTURED` |
| `card_4_second_capture_refused.json` | A further capture is refused: 422 `AUTHORIZATION_ALREADY_CAPTURED` |
| `card_5_partial_refund_rest.json` | `POST /v2/payments/captures/{id}/refund` for 3.29 USD: `COMPLETED` |
| `toolkit_create_refund.json` | PayPal Agent Toolkit 1.11.0 tools `create_refund`, `get_refund`, `get_order` called for real (refund of 1.00 USD: `COMPLETED`) |
| `toolkit_tools.json` | The toolkit tools SwapSafe enables |
| `voidcard_1_create_order_authorize_card.json`, `voidcard_2_void.json`, `voidcard_3_get_authorization_after_void.json` | An authorization of 7.98 USD released with `POST /v2/payments/authorizations/{id}/void`: `VOIDED` |

The card runs were used to exercise the Payments v2 calls without a browser. The `app_e2e_*` runs used a local build of the app with the in-memory store. `webhook_verify_hosted_e2e.json` comes from the hosted deployment.
