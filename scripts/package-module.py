"""Package customer module source, excluding dependency development fixtures.

Preserves vendored source, manifests, licenses and remaining-file checksums. The resulting
archive must pass an offline WASI build before it is uploaded anywhere.
"""
import json
import sys
import tomllib
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
module = root / '_server_islands/operations'
destination = Path(sys.argv[1])
destination.parent.mkdir(parents=True, exist_ok=True)
entries = []
locked = {(p["name"],p["version"]) for p in tomllib.loads((module / "Cargo.lock").read_text())["package"] if "source" in p}
def include(path):
    if path.parts[:2] != ("vendor", "crates") or len(path.parts) < 4:
        return True
    crate = module / "vendor/crates" / path.parts[2]
    info = tomllib.loads((crate / "Cargo.toml").read_text())["package"]
    if (info["name"],info["version"]) not in locked:
        return False
    if path.parts[3] in {"tests", "benches", "examples", ".github", ".vim"}:
        return False
    # This artifact targets WASI only. Other libc platform modules are not compiled.
    if info["name"] == "libc" and len(path.parts) > 4 and path.parts[3] == "src":
        if path.parts[4] in {"unix","windows","fuchsia","teeos","qurt","vxworks","solid"}:
            return False
    return True
for file in sorted(module.rglob('*')):
    if not file.is_file():
        continue
    path = file.relative_to(module)
    if 'target' in path.parts or '__pycache__' in path.parts:
        continue
    if not include(path):
        continue
    entries.append((file, path.as_posix()))
size = sum(file.stat().st_size for file, _ in entries)
if size > 10 * 1024 * 1024 or len(entries) > 1000:
    raise SystemExit('Module source exceeds the customer source upload budget')
with zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED, strict_timestamps=False) as archive:
    for file, name in entries:
        if file.name == '.cargo-checksum.json' and 'crates' in file.parts:
            checksum = json.loads(file.read_text())
            checksum['files'] = {
                path: digest for path, digest in checksum['files'].items()
                if include(file.parent.relative_to(module) / path)
            }
            archive.writestr(name, json.dumps(checksum))
        else:
            archive.write(file, name)
print(json.dumps({'archive': str(destination), 'files': len(entries), 'source_bytes': size}))
