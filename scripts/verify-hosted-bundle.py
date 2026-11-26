"""Validate the exact generated folder before deploying; no credentials required."""

import ast
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def verify(root):
    root = root.resolve()
    config = json.loads((root / "vercel.json").read_text())
    functions = config.get("functions", {})
    if set(functions) != {"app.py"}:
        raise ValueError("Wrong backend config: expected only app.py; found " + ", ".join(functions))
    if config.get("framework") != "fastapi" or config.get("buildCommand") or config.get("outputDirectory"):
        raise ValueError("Backend requires FastAPI config, not the website's Vite settings")
    for pattern in functions:
        target = (root / pattern).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError("Function pattern does not match deployed file: " + pattern)
    manifest = json.loads((root / "bundle-manifest.json").read_text())
    if manifest.get("format") != "scanner-hosted-bundle-v2":
        raise ValueError("Regenerate this deployment folder with the corrected packager")
    for name, digest in manifest["hashes"].items():
        target = (root / name).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError("Missing or escaped generated file: " + name)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError("Generated file changed: " + name)
    package = root / "scanner_service"
    assert (package / "__init__.py").is_file(), "Package __init__.py missing"
    config = json.loads((root / "vercel.json").read_text())
    assert config["functions"]["app.py"]["includeFiles"] == "scanner_service/**", "Explicit Vercel package inclusion missing"
    # Verify every relative module dependency is present in this package.
    for file in package.glob("*.py"):
        for node in ast.walk(ast.parse(file.read_text(), filename=str(file))):
            if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module:
                module = node.module.split(".")[0]
                assert (package / (module + ".py")).is_file() or (package / module / "__init__.py").is_file(), "Missing relative module: " + module
    # Only this generated folder is added; no repository imports can satisfy it.
    sys.path.insert(0, str(root))
    hosted = importlib.import_module("scanner_service.hosted")
    assert Path(hosted.__file__).resolve() == package / "hosted.py", "Imported from outside the deployment folder"
    from scanner_service.quality import needs_action_review
    assert needs_action_review({"kind": "licensed", "corporate_actions_complete": False}), "Strict source gate changed"
    # A fresh isolated interpreter simulates an absolute-path function loader.
    # Strip database credentials from the CHILD process only; never change settings.
    environment = dict(os.environ)
    for key in list(environment):
        if key.startswith("SCANNER_DATABASE_") or key in ("DATABASE_URL", "DATABASE_URL_UNPOOLED", "SCANNER_ADMIN_TOKEN", "CRON_SECRET", "PYTHONPATH", "SCANNER_JOB_MODE"):
            environment.pop(key, None)
    probe = '''
import runpy, sys, sqlalchemy
from pathlib import Path
entry = Path(sys.argv[1]).resolve()
assert str(entry.parent) not in sys.path
assert "scanner_service" not in sys.modules
# Missing hosted settings must fail before any database connection is attempted.
def no_database(*args, **kwargs):
    raise AssertionError("Unexpected database access during package probe")
sqlalchemy.create_engine = no_database
try:
    runpy.run_path(str(entry))
except ValueError as error:
    assert str(error) == "Set a private postgresql+psycopg database URL with TLS enabled", str(error)
else:
    raise AssertionError("Missing hosted settings did not fail closed")
import scanner_service.hosted as hosted
assert Path(hosted.__file__).resolve() == entry.parent / "scanner_service" / "hosted.py"
print("Absolute-path entrypoint imports the generated package; hosted configuration fails closed as expected.")
'''
    with tempfile.TemporaryDirectory(prefix="scanner-bundle-loader-") as outside:
        subprocess.run([sys.executable, "-I", "-B", "-c", probe, str(root / "app.py")], cwd=outside, env=environment, check=True)
    print("PASS: generated scanner_service.hosted import, package closure, manifest, Vercel includeFiles and isolated entrypoint. No database/provider requests made.")


if __name__ == "__main__":
    verify(Path(__file__).resolve().parent)
