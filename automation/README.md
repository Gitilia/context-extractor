# Automation package

Install from this directory:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium
pytest
```

Project docs and consumer Cursor prompt live in the repo root (`../README.md`, `../CURSOR_PROMPT.md`).
