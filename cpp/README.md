# C++ terminal

This is an optional, dependency-free C++17 console demo of the simulated
electricity trading terminal. The browser application lives in the repository
root at `global_electricity_trading_platform.html`. This console program uses
randomly generated prices and order-book quantities; it does not connect to
exchanges, market feeds, or a brokerage.

## Build and run

With a C++17 compiler:

```sh
c++ -std=c++17 -Wall -Wextra -Wpedantic main.cpp -o volt_terminal
./volt_terminal
```

Or configure and build with CMake:

```sh
cmake -S . -B build
cmake --build build
./build/volt_terminal
```

## Commands

- `markets da`, `markets ida`, or `markets bal` — switch market groups
- `select <market-id>` — select a market, such as `select epex-de`
- `buy <quantity>` or `sell <quantity>` — add a simulated paper position
  (quantity must be between 1 and 500 MWh)
- `refresh` — simulate a new market-price tick
- `help` — show command usage
- `quit` — exit
