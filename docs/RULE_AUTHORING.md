# Rule Authoring

Sigma rules under `/rules/*.yml` are the **source of truth**. They are validated on load,
compiled to Wazuh XML at deploy, and evaluated in-process by the correlation scheduler.

## Required fields

Every rule must include (enforced by [`rules/schema/sigma-surf.json`](../rules/schema/sigma-surf.json)):

`id` (UUID), `title`, `description`, `author`, `date` (`YYYY/MM/DD`), `references` (≥1 URI),
`level` (`critical|high|medium|low|informational`), `tags` (must contain an `attack.*` tag),
`logsource`, `detection` (with `condition`), `falsepositives` (≥1), `owner`, `surf.compliance`
(≥1). `surf.threat_id` (`AV-NN`) is recommended.

## Supported detection grammar

The evaluator implements a deliberate subset of Sigma (everything the 15 rules need). Adding
a construct beyond this list means extending `src/correlation/evaluator.ts` **with tests**.

```
condition: selection
condition: selection and not filter
condition: selection | count() > N
condition: selection | count() by <field> > N
condition: selection | count(<field>) by <field> >= N     # distinct-count
condition: (sel_a | count() by <field> >= N) and sel_b     # MFA-fatigue style
```

Field matchers: exact value, list (`in`), `|contains` (substring), and `|contains` with a
list (contains-any). `timeframe: <n>[smhd]` bounds aggregated conditions.

## Wazuh rule id block

Compiled rules occupy Wazuh ids **100100–100199** (reserved for SURF). `convert-sigma.ts`
assigns them in file order; keep the `R-NN` prefixes contiguous.

## Workflow

```bash
# 1. author rules/R-16-my-rule.yml (copy an existing rule)
# 2. validate against the schema
npm run rules:validate
# 3. add fixtures
#    backend/test/fixtures/events/R-16/positive.json   (must match)
#    backend/test/fixtures/events/R-16/negative.json   (must NOT match)
# 4. run the fixture gate
npm run test:rules
# 5. preview the compiled Wazuh XML
npm run rules:convert -- --dry-run
```

CI (`rule-tests.yml`) fails the build if any rule misses its positive fixture or matches its
negative one — this is the detection contract.

## Enrichment vs. detection

Prefer computing complex conditions (geo distance, semver comparison, allow-list membership)
at **ingest time** as a `surf.enrichment.*` boolean, then matching that boolean in the rule.
This keeps rules readable, portable to Wazuh, and cheap to evaluate every 60 s.
