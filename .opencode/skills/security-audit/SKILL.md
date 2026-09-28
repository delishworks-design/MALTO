---
name: security-audit
description: Audit MALTO changes for secrets exposure, unsafe input handling, authentication, authorization, URL fetching, XSS, SSRF, injection, and other web security risks.
---

# MALTO Security Audit

Treat all user-provided input, external URLs, and remote data as untrusted.

## Inspect
- client/server boundaries
- environment variables and secrets
- API routes and server actions
- authentication and authorization
- URL fetching and SSRF risk
- XSS and unsafe HTML rendering
- injection risks
- validation and parsing
- file uploads if present
- sensitive logging
- rate limiting where relevant
- dependency changes

## Rules
- Never expose secrets to client-side bundles.
- Never print tokens or credentials in logs.
- Validate and constrain externally supplied URLs.
- Prefer allowlists and safe parsers over string-based trust assumptions.
- Preserve existing security controls.
- Do not weaken security to make a feature easier to implement.

## Output
Classify findings as Critical, High, Medium, Low, or Informational and include the affected file and concrete remediation.
