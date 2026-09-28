# MALTO — OpenCode Project Instructions

## Project identity
MALTO is a production-oriented Next.js/React/TypeScript application. Preserve the existing product identity and architecture unless a change is required.

## Before changing code
1. Inspect the relevant existing components, styles, utilities, and data flow.
2. Reuse existing components and design tokens before creating new ones.
3. Avoid broad rewrites when a focused change is sufficient.
4. Do not remove working functionality merely to simplify implementation.

## UI/UX
- Preserve MALTO's existing visual language and design-system CSS.
- Do not introduce random fonts, colors, gradients, shadows, or decorative patterns.
- Prefer strong hierarchy, intentional whitespace, clear alignment, and restrained visual polish.
- Every interactive component should have appropriate hover, focus, active, disabled, loading, error, and success states.
- Avoid generic AI-dashboard aesthetics and unnecessary card nesting.
- Maintain accessible contrast, focus states, labels, and keyboard behavior.

## Responsive requirements
Verify important UI at:
- 360px
- 390px
- 430px
- tablet
- 1280px desktop
- 1440px desktop

Watch for overflow, clipped content, broken grids, awkward wrapping, and touch-target problems.

## Verification
After meaningful changes, run the project's applicable checks, including:
- lint
- typecheck if available
- tests
- production build

For user-facing UI changes, verify the actual running application in a browser before declaring the work complete.

## Safety
- Never expose secrets or environment-variable values.
- Do not commit API keys, tokens, credentials, or private service configuration.
- Treat external URLs and user-provided input as untrusted.
- Do not weaken authentication, authorization, validation, or security controls without explicit justification.

## Completion standard
Do not report "done" merely because code compiles. Report what was changed, what was verified, and any remaining limitations.
