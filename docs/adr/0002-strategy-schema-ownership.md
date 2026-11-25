# ADR-0002: Strategy schema owned by Python Pydantic models

Status: Accepted (2026-11-23, project setup)

## Context

The strategy definition is used by the web form, validated by the API, produced by the
LLM, and executed by the engine. Two hand-maintained copies would drift.

## Decision

Pydantic models in `services/quant` are the single source of truth. A script exports
JSON Schema into `packages/shared`, from which TypeScript types (and Zod validators if
needed) are generated. Generated files are committed and must not be edited by hand.

## Consequences

- The engine, which gives the schema its meaning, owns it.
- Schema changes require regenerating `packages/shared`; CI should fail if the
  generated output is stale (mechanism to add with the first schema).
- The schema is versioned (`schema_version` field) so stored strategies stay readable.

## Alternatives

- Zod in TypeScript as source, exporting JSON Schema to Python: more natural for the UI,
  but puts semantics away from the engine that executes them.
