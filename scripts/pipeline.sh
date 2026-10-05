#!/bin/sh
# Full catalog build. Resumable: re-run and it skips work already done.
cd "$(dirname "$0")/.." || exit 1
export RATE=${RATE:-8} THREADS=${THREADS:-8}
P="python3 scripts/catalog.py"
$P cg && $P enrich && $P build && \
$P scan 64500 96000 && $P scan 1 44000 && $P retry && \
$P enrich && $P names && $P build
echo "pipeline done: $?"
