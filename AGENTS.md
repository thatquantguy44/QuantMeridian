# Repository agent guidance

For changes to `docs/specs/spec012/`, the Sources & Uses page and contracts, or its service and optimization model, use the pinned upstream skills in `.agents/skills/`:

1. Start with `using-agent-skills` and follow `incremental-implementation` for multi-file changes.
2. Use `test-driven-development` for behavior and `doubt-driven-development` for independent technical validation.
3. Apply `code-review-and-quality` before marking a slice complete. Use `frontend-ui-engineering` for the Sources & Uses UI.
4. Verify the immutable upstream snapshot with `npm run check:agent-skills-pin`; CI runs the same check.
5. Follow approved decisions in spec012. Do not encode unresolved decisions into model behavior.

The vendored skill files are byte-for-byte copies from `thatquantguy44/agent-skills` at the commit and paths recorded in `contracts/agent/agent-skills.pin.json`. Update them only by reviewing and intentionally advancing that pin. This guidance applies to SXU work; it does not change instructions or architecture for unrelated modules.
