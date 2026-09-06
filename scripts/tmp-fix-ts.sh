#!/bin/bash
cd /mnt/d/workspace/BitFun_OHOS/BitFun || exit 1
python3 - <<'PYEOF'
import io
files = [
    'src/web-ui/src/app/components/NavPanel/NavSearchDialog.tsx',
    'src/web-ui/src/app/scenes/agents/components/IndustryAgentCard.tsx',
    'src/web-ui/src/flow_chat/components/modern/SessionShareFilesButton.tsx',
]
for f in files:
    with open(f, 'r', encoding='utf-8') as fh:
        text = fh.read()
    text = text.replace('\u9225?', '\u2014')
    with open(f, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text)
print('em-dash comments restored')
PYEOF
grep -rn -a -e '鈥' -e '锟' --include=*.ts --include=*.tsx src/web-ui/src/ 2>/dev/null | wc -l
