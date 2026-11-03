# Team Duel CP-SAT experiment

Offline benchmark using OR-Tools 9.15.6755. Its CLI adapter now calls the shared production solver in `server/duel_solver.py`. The benchmark does not contact Supabase, save squads, or generate fixtures. Production Fast-mode setup is documented in `docs/league-team-duel.md`.

## Run

Tested with Python 3.12 and Node 24 on Windows, with the repository's npm dependencies installed. Create an isolated environment inside the ignored artifacts directory:

```powershell
python -m venv artifacts.local/duel-cpsat/venv
& './artifacts.local/duel-cpsat/venv/Scripts/python.exe' -m pip install -r scripts/experiments/duel-cpsat/requirements.txt
node scripts/experiments/duel-cpsat/benchmark.mjs --python artifacts.local/duel-cpsat/venv/Scripts/python.exe
& './artifacts.local/duel-cpsat/venv/Scripts/python.exe' -m unittest discover -s scripts/experiments/duel-cpsat -p test_solver.py -v
```

On other platforms, use the environment's `bin/python`. `DUEL_CPSAT_PYTHON` also selects the Python executable. `--seconds 30` changes the solver budget per ordinary case, `--baseline-seconds 10` changes the exhaustive baseline budget, and repeated `--case <name>` arguments select cases. Budgets apply only to this experiment. The production exhaustive search remains unchanged.

The runner writes full solutions and measurements to ignored `artifacts.local/duel-cpsat/results.json` after every case. It independently verifies returned fixtures with application code: participant membership, round conflicts, game counts, both meeting caps, TrueSkill match probabilities, and exact conditional season chances. It also computes a court order using the existing ordering function.

## Model

Squads are fixed before solving. Each Boolean variable selects one possible doubles matchup in one round. Fourteen players have 441 possible matchups and seven rounds. Labeling each round by its home-squad bye removes equivalent round permutations, leaving 2,205 game/round variables rather than enumerating 66,150 complete-round configurations first. Even squads order rounds by their lowest matchup index to remove some equivalent permutations.

Constraints require equal participation, complete rounds, no double booking, and the supplied partner/opponent caps. Explicit minimum distinct-meeting counts are derived from participation and caps; they introduce no extra coverage requirement. The objective minimizes the integer rank of the highest favorite probability among selected games. Ranks preserve the order of the authoritative floating-point probabilities, avoiding probability rounding into an integer objective.

The exact 55/45 season rule is checked on solver incumbents. An optimal structural solution outside that rule is excluded by a constraint on the entire game-count vector, which rules out all round arrangements of that same rejected game multiset. The solver then runs again within the original budget. This rejection loop may itself be expensive.

`OPTIMAL` means CP-SAT proved the minimum worst-match probability for these fixed squads and the solution passes the exact season check. `FEASIBLE` means a checked valid schedule exists without that proof. `UNKNOWN` means no checked schedule or infeasibility proof was obtained within the budget. `INFEASIBLE` refers to the requested model, including any explicit `maxWorst` ceiling. A time limit never becomes an infeasibility claim or an excuse to relax the meeting/season limits.

## Observed results

Measured on 2026-11-03, formulation version 2. Times include Python model construction and solving, but exclude loading Python, OR-Tools, and Vite. Eight-thread timings use more CPU than the browser worker and can vary between runs.

- Equal-rated 14 players, caps 2/2: **4.43 seconds on one solver thread**, or **1.10 seconds with eight**, both proven optimal at a 50.0000015% worst favorite probability. The current exhaustive feasibility search did not finish its single-squad-split comparison within the explicit 10-second experiment budget; the runner terminated that worker.
- Mixed-rating 14 players, caps 2/2: with eight threads, the first season-balanced incumbent arrived in **2.67 seconds**. At the **15-second** limit the best checked schedule had a **70.016%** worst favorite probability and **50.27% / 49.73%** season chances. It was feasible, not proven optimal. The one-thread run produced a much poorer 95.917% worst match at the same budget.
- Requiring every mixed-rating 14-player match to have a favorite probability of at most 70% produced **UNKNOWN** after 15 seconds with either one or eight threads. This does not prove that such a schedule is impossible.
- Audited 12-player fixed squads, supplied with the known 67.576222% ceiling: **0.45 seconds** for a proven optimum matching the original search. A ceiling lower by `1e-8` was proven infeasible in **0.17 seconds**. These are fixed-squad, bounded tests; they are not a comparison against the application's roughly 18-second search over all squad splits.
- Equal-rated 8- and 10-player cases with partner cap one solved optimally in approximately **0.02 and 0.04 seconds**. An impossible opponent cap of one was rejected as infeasible.
- A deliberately one-sided synthetic probability case rejected **30** structurally optimal candidates in 0.8 seconds and returned **UNKNOWN** with no schedule. Rejected candidates were never presented as valid or optimal.

The mixed-rating fixture uses the existing anonymous twelve-player rating/uncertainty snapshot plus two synthetic players. Squad selection minimizes total-rating difference only, providing a reproducible test of the proposed balanced-total approach. It is not a fourteen-player production-season snapshot.

## Conclusion and remaining scope

CP-SAT is promising for the equal-rating case that stalls the custom search. It is not yet a universally faster replacement: mixed-rating optimization still needs work, and tight quality thresholds can consume the whole budget without a solution.

This benchmark tests worst-match probability for one fixed split, not global squad selection or all three profile objectives. The production service additionally implements balance/variety/experience profiles and history tie breakers. It retains the saved-plan format and existing database validation. The timings above describe formulation version 2; the current shared solver is version 3, with structural warm starts and additional objectives.

References: [OR-Tools scheduling examples](https://developers.google.com/optimization/scheduling/employee_scheduling), [official CP-SAT Python implementation](https://github.com/google/or-tools/blob/stable/ortools/sat/python/cp_model.py).
