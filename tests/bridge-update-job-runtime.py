"""Host checks for deterministic, durable bridge-owned update jobs."""
from pathlib import Path
import json
import subprocess
import tempfile

from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix="coollamp-bridge-update-job-") as folder:
    binary = Path(folder) / "bridge-update-job.exe"
    subprocess.run(
        [
            "g++",
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            *SANITIZERS,
            "-I" + str(ROOT),
            str(ROOT / "tests/bridge-update-job-runtime.cpp"),
            str(ROOT / "bridge/BridgeUpdateJob.cpp"),
            "-o",
            str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)
    rendered = subprocess.run(
        [str(binary), "--json"], check=True, capture_output=True, text=True
    ).stdout.splitlines()
    snapshots = [json.loads(line) for line in rendered if line.strip()]
    assert [item["phase"] for item in snapshots] == [
        "accepted",
        "succeeded",
        "failed",
        "cancelled",
    ]
    contract_url = (ROOT / "mobile/src/update-job-contract.js").as_uri()
    node_source = f"""
import fs from 'node:fs';
import {{ normalizeUpdateJobSnapshot }} from {json.dumps(contract_url)};
const snapshots=JSON.parse(fs.readFileSync(0,'utf8'));
for (const snapshot of snapshots) normalizeUpdateJobSnapshot(snapshot);
console.log('PASS bridge JSON projections normalize under the mobile contract');
"""
    subprocess.run(
        ["node", "--input-type=module", "-e", node_source],
        input=json.dumps(snapshots),
        text=True,
        check=True,
    )
