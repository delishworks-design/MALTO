---
name: testing
description: Plan and execute appropriate MALTO tests for code changes, with emphasis on regression prevention and realistic user flows.
---

# Testing Skill

Choose the smallest useful test set for the change, then run it.

## Priorities
1. Existing project tests
2. Type checking
3. Linting
4. Production build
5. End-to-end browser tests for critical user-facing flows

## Test behavior, not implementation details
Prefer tests that verify what users and APIs observe instead of tests tightly coupled to internal implementation.

## For UI changes
Verify:
- rendering
- interaction
- validation
- loading
- error
- success
- responsive behavior where practical

## For API/server changes
Verify:
- valid input
- invalid input
- authorization
- error handling
- important edge cases
- safe handling of external input

## Completion
Report commands run and whether each passed. If a check cannot run, say why.
