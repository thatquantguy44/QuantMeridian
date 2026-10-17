# QuantMeridian Optimization Core

Shared solver-neutral primitives for independently verified continuous linear programs.

The first slice provides a named sparse builder, a ranged-row `LinearProblem` contract, a
`SolverBackend` port, SciPy's HiGHS LP adapter, and an independent primal/objective verifier.
Results are only candidates until `verify_solution` passes. The core does not connect to a
database, read market data, choose policy defaults, or construct product-specific models.

This version intentionally supports continuous LPs only. Mixed-integer support, additional
elastic diagnostics beyond the utilization-only helper, service APIs, authentication, run history,
and product contracts are follow-up work.

## Utilization-only elastic diagnostic

`diagnose_utilization_elastic` builds and solves a separate LP from a named `LinearProblem`. The
caller supplies explicit allowlists for `utilization_min...` and `utilization_max...` rows plus
the inventory's positive `total_lendable_shares`. Only those requested lower or upper bounds gain
nonnegative slack; every other row remains hard. The diagnostic zeros the model objective and
minimizes the sum of each raw share slack divided by `total_lendable_shares` (one priority tier).
It independently verifies the diagnostic solution and returns that verification report with its
own status. Per-row raw and normalized slack measurements are populated only for an optimal
diagnostic solution that passes verification. It does not change the original problem or a
previously computed solve, verification, or recommendation, and its output must not be presented
as the original optimization result.

## Local use

Install this package in the consuming service environment, create a `SparseProblemBuilder`, add
variables and ranged rows, call `HighsBackend.solve`, and independently check the returned
`LinearSolution` with `verify_solution` before presenting any result.
