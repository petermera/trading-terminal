# Trading Terminal Prototype

A compact front-end prototype for exploring a European electricity-trading dashboard.

> **Current status:** visual demonstration only. Prices, positions, trades, and market activity are simulated. Do not use this repository for live trading decisions.

## Start here

The prototype is contained in [`global_electricity_trading_platform.html`](./global_electricity_trading_platform.html). It is an HTML/CSS/JavaScript interface fragment intended for design exploration.

It demonstrates:

- EPEX, Nord Pool, OMIE, and balancing-market views;
- market cards, price charts, order-book depth, positions, and a trade ticket;
- simulated price movement and trade activity;
- a responsive, theme-aware terminal layout.

## Repository relationship

This is the smaller sibling of [`petermera/Terminal_Trading`](https://github.com/petermera/Terminal_Trading), which is the main repository for the developed version of the same concept.

Use this repository for lightweight experiments. Put shared documentation, data-integration work, and the longer-term product direction in `Terminal_Trading`.

## Before connecting real data

A real feed should identify the source, market, bidding zone, product, delivery interval, timezone, unit, publication time, and data vintage. Simulated and observed values must remain visibly different.

The planned data foundation is [`petermera/eu-grid-data-connectors`](https://github.com/petermera/eu-grid-data-connectors).
