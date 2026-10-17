# QuantMeridian Optimization Core

Shared solver-neutral primitives for independently verified continuous linear programs.

The first slice provides a named sparse builder, a ranged-row `LinearProblem` contract, a
`SolverBackend` port, SciPy's HiGHS LP adapter, and an independent primal/objective verifier.
Results are only candidates until `verify_solution` passes. The core does not connect to a
database, read market data, choose policy defaults, or construct product-specific models.

This version intentionally supports continuous LPs only. Mixed-integer support, elastic
diagnostics, service APIs, authentication, run history, and product contracts are follow-up work.

## Local use

Install this package in the consuming service environment, create a `SparseProblemBuilder`, add
variables and ranged rows, call `HighsBackend.solve`, and independently check the returned
`LinearSolution` with `verify_solution` before presenting any result.
