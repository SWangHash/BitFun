#!/bin/bash
cd /mnt/d/workspace/BitFun_OHOS/BitFun/src/apps/desktop || exit 1
export OHOS_HOME=/usr/ohos-sdk/command-line-tools/sdk/default/openharmony
export OHOS_SDK_HOME="$OHOS_HOME"
export PATH=/usr/ohos-sdk/command-line-tools/bin:/usr/ohos-sdk/command-line-tools/ohpm/bin:/root/.cargo/bin:$PATH
rm -f /tmp/ohos-build.log
echo "BUILD START $(date)" > /tmp/ohos-build.log
exec cargo tauri ohos build --debug >> /tmp/ohos-build.log 2>&1
