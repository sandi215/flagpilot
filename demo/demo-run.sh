#!/usr/bin/env bash
# FlagPilot demo run — used for the ≤3 min demo video (one full run, no intervention).
# Runs the canned checkout-button experiment end to end in mock mode.
set -e
cd "$(dirname "$0")/.."
node flagpilot.mjs demo --mock --approve
