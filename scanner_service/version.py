import hashlib
from pathlib import Path
import numpy
import pandas
from importlib.metadata import version

ENGINE_VERSION = "structure-eod-0.1.0"


def provenance():
    root = Path(__file__).parent
    files = ["schema.py", "indicators.py", "structure.py", "research.py", "backtest.py"]
    fingerprint = hashlib.sha256(
        b"".join((root / file).read_bytes() for file in files)
    ).hexdigest()
    return {
        "engine_version": ENGINE_VERSION,
        "engine_sha256": fingerprint,
        "pandas": pandas.__version__,
        "numpy": numpy.__version__,
        "frameworks": {
            name: version(name)
            for name in ["fastapi", "pydantic", "SQLAlchemy", "psycopg"]
        },
    }
