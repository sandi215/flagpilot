# Example prompt — signup form length

Compare the signup form: three-field vs six-field, 70/30 split, success is a new signup.

Run it:

```bash
node flagpilot.mjs plan "Compare the signup form: three-field vs six-field, 70/30 split, success is a new signup."
node flagpilot.mjs apply --approve --mock
```

Expected plan: flag `signup_form`, variants control "three-field" 70% /
challenger_1 "six-field" 30%, metric Sign-up (event `signup_completed`).
