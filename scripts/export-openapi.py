import json
from pathlib import Path
from comandei.main import app

output = Path("packages/api-client")
output.mkdir(parents=True, exist_ok=True)
(output / "openapi.json").write_text(
    json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print("Contrato OpenAPI exportado.")
