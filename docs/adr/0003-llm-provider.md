# ADR-0003: Claude API for strategy parsing, behind a provider interface

Status: Accepted (2026-11-23, project setup)

## Context

Plain-English strategies must become schema-valid strategy JSON, and results need a
readable explanation. Accuracy of structured output matters more than cost at this scale.

## Decision

Use the Anthropic Claude API from `services/quant`, requesting structured output
(tool use / JSON schema) matching the strategy schema. Call it through a small
`LLMProvider` interface so another provider can be swapped in. The model ID is
configuration, not hard-coded. Output is validated per QP-STD-007.

## Consequences

- Requires an API key (env var, QP-STD-006) and incurs per-request cost; the API applies
  per-user rate limits.
- Parsing accuracy is measured with a fixed evaluation set of prompts and expected
  strategy JSON, tracked over time.
- Tests use a fake provider; live-model evaluation runs separately.

## Alternatives

- OpenAI API: comparable, same interface would apply.
- Local model via Ollama: free, but weaker structured-output accuracy.
