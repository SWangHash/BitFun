#!/bin/bash
cd /mnt/d/workspace/BitFun_OHOS/BitFun || exit 1
f=src/crates/assembly/core/src/agentic/execution/execution_engine.rs
git show 6e080b0af:$f | grep -a -F 'repeat(62)' | head -1 > /tmp/newline
L=$(grep -a -n utf8_boundary $f | head -1 | cut -d: -f1)
T=$((L+2))
echo "target line: $T"
sed -i "${T}d" $f
sed -i "${T}r /tmp/newline" $f
sed -n "${T}p" $f | od -c | head -5
