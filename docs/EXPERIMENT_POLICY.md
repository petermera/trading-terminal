# Visual Experiment Policy

- Status: active proposal
- Last updated: 2026-08-29
- Audience: designers, developers, and AI assistants

## Plain-language purpose

This repository is the sketchbook for trading-terminal ideas. It can move quickly and try layouts without making the main `Terminal_Trading` project unstable. It is not the authoritative live product.

## Repository role

- Test one visual or interaction question at a time.
- Use synthetic, public-safe fixtures by default.
- Record what was learned, including failed experiments.
- Move proven ideas into `Terminal_Trading` through a fresh implementation or a reviewed, small extraction.

Do not connect this repository directly to credentials, brokerage execution, customer data, personal financial data, or private vault content.

## Experiment card

Each experiment should document:

```yaml
question: what are we trying to learn?
user: who benefits?
fixture: synthetic or public-safe input
success_signal: observable evidence
decision_date: YYYY-MM-DD
outcome: continue | revise | graduate | archive
```

## Graduation criteria

An idea can move to `Terminal_Trading` when:

1. the user problem and successful behavior are clear;
2. simulated or sample data is visibly labelled;
3. keyboard, mobile, empty, loading, and error states were considered;
4. required data fields match the grid integration contract;
5. the destination implementation has tests and documentation appropriate to its risk.

Graduation does not mean copying the entire experiment history or dependencies. Carry over the smallest useful design and its evidence.

## Archive criteria

Archive an experiment when its question is answered, it duplicates a better direction, or it has had no owner past its decision date. Add a short outcome note so future work does not repeat the same test unknowingly.

## Next experiments

- compare a dense analyst layout with a guided beginner layout;
- test how source freshness and data-quality flags should appear;
- test a model-signal explanation without implying a trade recommendation.

## Risks and open questions

- Visual experiments may be mistaken for production capabilities.
- Parallel prototypes can create duplicate components without a graduation decision.
- Open question: should completed experiments remain on `main` as a gallery or move to tagged archive branches?
