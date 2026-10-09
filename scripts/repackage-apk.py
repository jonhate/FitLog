#!/usr/bin/env python3
"""Update frontend assets in an existing native APK; this is not a Gradle build.
Usage: python scripts/repackage-apk.py BASE.apk DIST OUTPUT.apk BUILD_TOOLS KEYSTORE
Uses the local development signing key (androiddebugkey / android).
"""
import hashlib
import pathlib
import subprocess
import sys
import tempfile
import zipfile

base, dist, output, build_tools, key = map(pathlib.Path, sys.argv[1:])
with tempfile.TemporaryDirectory(prefix='fitlog-apk-') as temporary:
    unsigned = pathlib.Path(temporary) / 'unsigned.apk'
    aligned = pathlib.Path(temporary) / 'aligned.apk'
    with zipfile.ZipFile(base) as source, zipfile.ZipFile(unsigned, 'w') as target:
        if source.testzip() is not None:
            raise RuntimeError('Invalid baseline APK')
        for entry in source.infolist():
            if not entry.filename.startswith(('assets/public/', 'META-INF/')):
                target.writestr(entry, source.read(entry.filename))
        for path in sorted(dist.rglob('*')):
            if path.is_file():
                target.write(path, 'assets/public/' + path.relative_to(dist).as_posix(), compress_type=zipfile.ZIP_DEFLATED)
    subprocess.run([str(build_tools / 'zipalign'), '-f', '-p', '4', str(unsigned), str(aligned)], check=True)
    subprocess.run([str(build_tools / 'apksigner'), 'sign', '--ks', str(key), '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--v4-signing-enabled', 'false', '--out', str(output), str(aligned)], check=True)
    subprocess.run([str(build_tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(output)], check=True)
    subprocess.run([str(build_tools / 'zipalign'), '-c', '-p', '4', str(output)], check=True)
    with zipfile.ZipFile(output) as apk, zipfile.ZipFile(base) as original:
        assert apk.testzip() is None
        for path in dist.rglob('*'):
            if path.is_file():
                assert apk.read('assets/public/' + path.relative_to(dist).as_posix()) == path.read_bytes()
        for entry in original.namelist():
            if not entry.startswith(('assets/public/', 'META-INF/')):
                assert apk.read(entry) == original.read(entry), entry
        assert not any(name.endswith('.wasm') for name in apk.namelist())
print('ZIP, alignment, frontend assets and unchanged native files: PASS')
print('SHA256:', hashlib.sha256(output.read_bytes()).hexdigest())
print('Bytes:', output.stat().st_size)
