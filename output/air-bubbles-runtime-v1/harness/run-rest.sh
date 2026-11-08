#!/bin/sh
# Runs after visual.mjs, one Chrome job at a time (playtests must not overlap).
cd "$(dirname "$0")/.."
node harness/smoke.mjs prod-base > evidence/smoke-prod-base.log 2>&1; echo "smoke base exit $?" >> evidence/run-rest.log
node harness/perf.mjs webgl canvas-accel canvas-soft > evidence/perf.log 2>&1; echo "perf exit $?" >> evidence/run-rest.log
node harness/sustained.mjs 120 webgl canvas-accel > evidence/sustained.log 2>&1; echo "sustained exit $?" >> evidence/run-rest.log
echo ALLDONE >> evidence/run-rest.log
