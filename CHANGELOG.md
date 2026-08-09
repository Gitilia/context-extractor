# Changelog

## Unreleased

## 1.5.0 — 2026-08-09

- **Interesting controls inventory** — `inventoryControls()` / `inventory_controls()` lists buttons, menuitems, and `aria-label` nodes with visible vs hidden flags; AI prompts include an Interesting Controls section
- **Truncate long `data:` URIs** in markdown links and prompt/network dumps (and extension Copy Network) so inlined images do not blow up agent context
- Fix Python `__version__` drift (was stuck at 1.3.0 while packages reported 1.4.0)

## 1.4.0

- Prior unified product version across extension, Python, and Node packages
