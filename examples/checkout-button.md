# Example prompt — checkout button copy

Test the copy on the checkout button: 'Buy now' vs 'Complete purchase', success is a completed purchase.

Run it:

```bash
node flagpilot.mjs plan "Test the copy on the checkout button: 'Buy now' vs 'Complete purchase', success is a completed purchase."
node flagpilot.mjs apply --approve --mock
```

Expected plan: flag `checkout_button`, variants control "Buy now" 50% /
challenger_1 "Complete purchase" 50%, metric Purchase
(event `purchase_completed`).
