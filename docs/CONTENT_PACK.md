# Detection Content Pack & ATT&CK Coverage

The **content pack** turns the `/rules` roster into a versioned, shippable product artifact: a
manifest, a MITRE ATT&CK coverage map, and ready-to-import ATT&CK Navigator layers. This is the
packaging that lets detection content ship as a **versioned subscription** (P2 #8) — a customer
can see exactly which techniques a pack version covers and diff one version against the next.

`/rules` remains the single source of truth. The pack is **generated**, never hand-edited.

## Artifacts (`content-pack/`)

| File | What it is |
|------|-----------|
| `manifest.json` | Pack name + version, `generatedAt`, `ruleCount`, a **`contentHash`** over the roster, and a per-rule summary (level, status, techniques, tactics, compliance count). |
| `coverage-map.json` | ATT&CK coverage: enterprise techniques, ICS techniques, tactic coverage, and `tacticUnmapped` (content gaps) — each mapped to the covering rule ids. |
| `navigator-enterprise.json` | [ATT&CK Navigator](https://mitre-attack.github.io/attack-navigator/) layer, `domain: enterprise-attack`. Import it to visualise coverage; technique **score = number of rules** covering it. |
| `navigator-ics.json` | Navigator layer, `domain: ics-attack` (the OT/energy techniques — the differentiator for a KRITIS pack). |
| `COVERAGE.md` | Human-readable coverage report (the tables you can drop into a datasheet). |

## Building & the CI gate

```sh
npm run pack:build     # regenerate content-pack/ from /rules
npm run pack:check     # CI gate: fail if the committed pack has drifted from /rules
```

`pack:build` loads rules through the **same validated `SigmaRuleLoader`** the runtime uses, so the
pack can never describe a roster the portal wouldn't accept. Build logic lives in
[`backend/src/correlation/contentPack.ts`](../backend/src/correlation/contentPack.ts) (pure and
unit-tested in [`backend/test/rules/contentPack.test.ts`](../backend/test/rules/contentPack.test.ts)).

`pack:check` compares the **version- and timestamp-independent** parts (the `contentHash` and the
coverage map) so it fails only on real content drift, not on a rebuild timestamp. It runs as the
`content-pack` job in CI and gates the image build — **add or change a rule and you must re-run
`pack:build` and commit the result**, or CI goes red.

## Versioning

Default version is calendar-based `YYYY.MM.build` (e.g. `2026.07.1`); override with
`CONTENT_PACK_VERSION` for an intentional release tag. The `contentHash` is derived from the rule
content only (identity + detection + tags), independent of version/timestamp — so two builds hash
equal iff the detection content is unchanged. That hash is the primitive a subscription channel
uses to answer "did the pack actually change?".

## Coverage from tags

Coverage is derived from each rule's Sigma `tags`:

- `attack.t1110`, `attack.t1078.004` → **enterprise** techniques (incl. sub-techniques).
- `attack.ics.T0813` → **ICS** techniques.
- `attack.credential_access`, `attack.impact`, … → **tactics**.

A rule that declares a technique but **no** `attack.<tactic>` tag is reported under
`tacticUnmapped` / "Content gaps" in `COVERAGE.md` — a prompt to tag its tactic so it appears in
the tactic view. See [`RULE_AUTHORING.md`](RULE_AUTHORING.md) for the tagging conventions.

## Roadmap (P2 #8 continued)

- Grow the roster toward 50–100 rules; the coverage map and gate scale with it unchanged.
- Serve `coverage-map.json` in the SOC portal as a live "MITRE coverage" view.
- Emit a signed pack (reuse the hash-chain signer) so subscribers can verify pack provenance.
