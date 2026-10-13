#include <algorithm>
#include <array>
#include <cmath>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <limits>
#include <random>
#include <sstream>
#include <string>
#include <vector>

namespace {

enum class Tab { DayAhead, Intraday, Balancing };
enum class Side { Buy, Sell };

struct Market {
  std::string id;
  std::string name;
  std::string region;
  std::string product;
  double base;
  double volatility;
  double price = 0.0;
  double change = 0.0;
  std::vector<double> history;
};

struct Position {
  std::string marketId;
  Side side;
  int quantity;
  double entryPrice;
};

struct Trade {
  std::string time;
  std::string market;
  Side side;
  int quantity;
  double price;
  double pnl;
};

class Terminal {
 public:
  Terminal() : random_(std::random_device{}()) {
    addMarkets(dayAhead_, {
        {"epex-de", "EPEX DE", "DACH", "DA", 85, 18, 0, 0, {}},
        {"epex-fr", "EPEX FR", "W.EU", "DA", 82, 15, 0, 0, {}},
        {"epex-at", "EPEX AT", "DACH", "DA", 87, 17, 0, 0, {}},
        {"epex-be", "EPEX BE", "W.EU", "DA", 83, 14, 0, 0, {}},
        {"omie-es", "OMIE ES", "Iberia", "DA", 78, 12, 0, 0, {}},
        {"omie-pt", "OMIE PT", "Iberia", "DA", 79, 12, 0, 0, {}},
        {"np-dk1", "NP DK1", "Nordic", "DA", 72, 20, 0, 0, {}},
        {"np-no1", "NP NO1", "Nordic",  "DA", 65, 22, 0, 0, {}},
        {"n2ex-uk", "N2EX UK", "UK", "DA", 91, 16, 0, 0, {}},
    });
    addMarkets(intraday_, {
        {"ida-de", "IDA DE", "DACH", "Intraday", 84, 22, 0, 0, {}},
        {"ida-fr", "IDA FR", "W.EU", "Intraday", 81, 19, 0, 0, {}},
        {"ida-es", "IDA ES", "Iberia", "Intraday", 77, 15, 0, 0, {}},
        {"ida-it", "GME IT", "Italy", "Intraday", 92, 14, 0, 0, {}},
        {"ida-pl", "TGE PL", "CEE", "Intraday", 88, 18, 0, 0, {}},
        {"ida-nl", "EPEX NL", "W.EU", "Intraday", 83, 14, 0, 0, {}},
    });
    addMarkets(balancing_, {
        {"afrr-de", "aFRR DE", "DACH", "aFRR cap", 95, 35, 0, 0, {}},
        {"mfrr-de", "mFRR DE", "DACH", "mFRR cap", 120, 45, 0, 0, {}},
        {"fcr-eu", "FCR EU", "EU", "FCR", 28, 12, 0, 0, {}},
        {"afrr-es", "aFRR ES", "Iberia", "aFRR", 88, 30, 0, 0, {}},
        {"rr-eu", "RR EU", "EU", "RR", 75, 18, 0, 0, {}},
        {"imbalance-de", "Imbal. DE", "DACH", "Imbalance", 110, 60, 0, 0, {}},
    });
    seedMarkets(dayAhead_);
    seedMarkets(intraday_);
    seedMarkets(balancing_);
    positions_ = {
        {"epex-de", Side::Buy, 50, 84.20},
        {"omie-es", Side::Sell, 30, 77.50},
        {"afrr-de", Side::Buy, 20, 93.00},
    };
    selected_ = findMarket("epex-de");
    updateSessionStats();
  }

  void run() {
    std::cout << "VOLT TERMINAL — SIMULATED PAPER TRADING ONLY\n"
              << "Enter 'help' for commands. No live data or orders are used.\n\n";
    render();

    std::string line;
    while (std::cout << "\nvolt> " && std::getline(std::cin, line)) {
      if (!execute(line)) break;
    }
  }

 private:
  std::vector<Market> dayAhead_;
  std::vector<Market> intraday_;
  std::vector<Market> balancing_;
  std::vector<Position> positions_;
  std::vector<Trade> trades_;
  Market* selected_ = nullptr;
  Tab tab_ = Tab::DayAhead;
  std::mt19937 random_;
  double sessionHigh_ = -std::numeric_limits<double>::infinity();
  double sessionLow_ = std::numeric_limits<double>::infinity();
  double sessionPriceSum_ = 0.0;
  int sessionPriceCount_ = 0;
  int sessionVolume_ = 0;

  static void addMarkets(std::vector<Market>& destination,
                         std::initializer_list<Market> markets) {
    destination.insert(destination.end(), markets.begin(), markets.end());
  }

  double randomBetween(double low, double high) {
    return std::uniform_real_distribution<double>(low, high)(random_);
  }

  void seedMarkets(std::vector<Market>& list) {
    for (auto& market : list) {
      market.price = market.base + randomBetween(-market.volatility / 2.0,
                                                 market.volatility / 2.0);
      for (int hour = 0; hour < 24; ++hour) {
        const double curve = market.base + std::sin(hour / 3.0) * 8.0;
        market.history.push_back(
            curve + randomBetween(-market.volatility * 0.3,
                                  market.volatility * 0.3));
      }
    }
  }

  std::vector<Market>& currentMarkets() {
    if (tab_ == Tab::Intraday) return intraday_;
    if (tab_ == Tab::Balancing) return balancing_;
    return dayAhead_;
  }

  std::vector<Market> allMarkets() {
    std::vector<Market> all;
    all.reserve(dayAhead_.size() + intraday_.size() + balancing_.size());
    all.insert(all.end(), dayAhead_.begin(), dayAhead_.end());
    all.insert(all.end(), intraday_.begin(), intraday_.end());
    all.insert(all.end(), balancing_.begin(), balancing_.end());
    return all;
  }

  Market* findMarket(const std::string& id) {
    for (auto* list : {&dayAhead_, &intraday_, &balancing_}) {
      const auto found = std::find_if(list->begin(), list->end(),
                                     [&](const Market& market) {
                                       return market.id == id;
                                     });
      if (found != list->end()) return &*found;
    }
    return nullptr;
  }

  const Market* findMarket(const std::string& id) const {
    for (const auto* list : {&dayAhead_, &intraday_, &balancing_}) {
      const auto found = std::find_if(list->begin(), list->end(),
                                     [&](const Market& market) {
                                       return market.id == id;
                                     });
      if (found != list->end()) return &*found;
    }
    return nullptr;
  }

  void selectMarket(Market* market) {
    selected_ = market;
    sessionHigh_ = -std::numeric_limits<double>::infinity();
    sessionLow_ = std::numeric_limits<double>::infinity();
    sessionPriceSum_ = 0.0;
    sessionPriceCount_ = 0;
    render();
  }

  void updatePrices() {
    for (auto* list : {&dayAhead_, &intraday_, &balancing_}) {
      for (auto& market : *list) {
        const double previous = market.price;
        const double drift = (market.base - market.price) * 0.03;
        const double noise = randomBetween(-0.48, 0.52) * market.volatility * 0.12;
        market.price = std::max(10.0, market.price + drift + noise);
        market.change = market.price - previous;
        market.history.push_back(market.price);
        if (market.history.size() > 24) market.history.erase(market.history.begin());
      }
    }
    updateSessionStats();
  }

  void updateSessionStats() {
    if (!selected_) return;
    sessionHigh_ = std::max(sessionHigh_, selected_->price);
    sessionLow_ = std::min(sessionLow_, selected_->price);
    sessionPriceSum_ += selected_->price;
    ++sessionPriceCount_;
  }

  static std::string sideName(Side side) {
    return side == Side::Buy ? "BUY" : "SELL";
  }

  static std::string signedMoney(double amount) {
    std::ostringstream output;
    output << (amount >= 0 ? "+" : "-") << "EUR "
           << std::fixed << std::setprecision(2) << std::abs(amount);
    return output.str();
  }

  void render() {
    std::cout << "\n=== VOLT TERMINAL | LIVE SIM | "
              << utcTime() << " UTC ===\n";
    std::cout << "Market tab: " << tabName() << " | Selected: "
              << selected_->name << " | Total P&L: "
              << signedMoney(totalPnl()) << " | Open positions: "
              << positions_.size() << "\n";
    renderMarketList();
    renderChart();
    renderOrderBook();
    renderPositions();
    renderSpreads();
    renderKpis();
    renderTradeLog();
  }

  void renderMarketList() {
    std::cout << "\nMARKETS (use 'select <id>' to change market)\n";
    std::cout << std::left << std::setw(12) << "ID" << std::setw(12) << "MARKET"
              << std::setw(10) << "REGION" << std::setw(12) << "PRICE"
              << std::setw(12) << "CHANGE" << "PRODUCT\n";
    for (const auto& market : currentMarkets()) {
      std::cout << std::left << std::setw(12) << market.id
                << std::setw(12) << market.name << std::setw(10) << market.region
                << std::setw(12) << std::fixed << std::setprecision(2)
                << market.price << std::setw(12) << market.change
                << market.product << (selected_->id == market.id ? "  <" : "")
                << "\n";
    }
  }

  void renderChart() const {
    const auto& history = selected_->history;
    const auto [minimum, maximum] = std::minmax_element(history.begin(), history.end());
    const double range = std::max(1.0, *maximum - *minimum);
    std::cout << "\nPRICE HISTORY (oldest -> latest, EUR/MWh)\n";
    for (int row = 7; row >= 0; --row) {
      const double threshold = *minimum + range * row / 7.0;
      std::cout << std::setw(7) << std::fixed << std::setprecision(1) << threshold
                << " |";
      for (const double value : history) {
        const int level = static_cast<int>(std::round((value - *minimum) / range * 7));
        std::cout << (level == row ? '*' : ' ');
      }
      std::cout << "\n";
    }
  }

  void renderOrderBook() {
    const double levelSpread = selected_->volatility * 0.02;
    std::cout << "\nORDER BOOK — " << selected_->name
              << " (bid volume | price | ask volume; simulated)\n";
    for (int level = 4; level >= 1; --level) {
      std::cout << std::setw(14) << " "
                << std::setw(10) << std::fixed << std::setprecision(2)
                << selected_->price + levelSpread * level
                << " | " << std::setw(4) << static_cast<int>(randomBetween(10, 90))
                << "\n";
    }
    std::cout << "---------------- spread " << std::fixed << std::setprecision(2)
              << levelSpread * 2 << " | mid " << selected_->price << " ----------------\n";
    for (int level = 1; level <= 4; ++level) {
      std::cout << std::setw(14) << static_cast<int>(randomBetween(10, 90))
                << " | " << std::setw(10) << selected_->price - levelSpread * level
                << "\n";
    }
  }

  void renderPositions() const {
    std::cout << "\nOPEN POSITIONS\n";
    if (positions_.empty()) std::cout << "  None\n";
    for (const auto& position : positions_) {
      const Market* market = findMarket(position.marketId);
      const double price = market ? market->price : position.entryPrice;
      const double pnl = (position.side == Side::Buy ? 1.0 : -1.0) *
                         (price - position.entryPrice) * position.quantity;
      std::cout << "  " << std::left << std::setw(12)
                << (market ? market->name : position.marketId) << sideName(position.side)
                << " " << position.quantity << " MWh @ " << std::fixed
                << std::setprecision(2) << position.entryPrice << " | "
                << signedMoney(pnl) << "\n";
    }
  }

  void renderSpreads() const {
    const std::array<std::pair<const char*, std::pair<const char*, const char*>>, 6> pairs{{
        {"DE-FR", {"epex-de", "epex-fr"}}, {"DE-AT", {"epex-de", "epex-at"}},
        {"ES-PT", {"omie-es", "omie-pt"}}, {"DE-DK1", {"epex-de", "np-dk1"}},
        {"UK-FR", {"n2ex-uk", "epex-fr"}}, {"IT-DE", {"ida-it", "ida-de"}},
    }};
    std::cout << "\nMARKET SPREADS (EUR/MWh)\n";
    for (const auto& pair : pairs) {
      const Market* first = findMarket(pair.second.first);
      const Market* second = findMarket(pair.second.second);
      if (first && second) {
        std::cout << "  " << std::setw(8) << pair.first << signedMoney(first->price - second->price)
                  << "\n";
      }
    }
  }

  void renderKpis() const {
    std::cout << "\nSESSION KPIs | VWAP: ";
    if (sessionPriceCount_ == 0) std::cout << "—";
    else std::cout << std::fixed << std::setprecision(2)
                   << sessionPriceSum_ / sessionPriceCount_ << " EUR/MWh";
    std::cout << " | High: ";
    if (sessionHigh_ == -std::numeric_limits<double>::infinity()) std::cout << "—";
    else std::cout << std::fixed << std::setprecision(2) << sessionHigh_;
    std::cout << " | Low: ";
    if (sessionLow_ == std::numeric_limits<double>::infinity()) std::cout << "—";
    else std::cout << std::fixed << std::setprecision(2) << sessionLow_;
    std::cout << " | Volume: " << sessionVolume_ << " MWh\n";
  }

  void renderTradeLog() const {
    std::cout << "\nRECENT PAPER TRADES\n";
    if (trades_.empty()) std::cout << "  No trades yet\n";
    const std::size_t start = trades_.size() > 8 ? trades_.size() - 8 : 0;
    for (std::size_t index = trades_.size(); index > start; --index) {
      const auto& trade = trades_[index - 1];
      std::cout << "  " << trade.time << " " << sideName(trade.side) << " "
                << trade.quantity << " MWh " << trade.market << " @ "
                << std::fixed << std::setprecision(2) << trade.price << " | "
                << signedMoney(trade.pnl) << "\n";
    }
  }

  double totalPnl() const {
    double total = 0;
    for (const auto& position : positions_) {
      const Market* market = findMarket(position.marketId);
      const double price = market ? market->price : position.entryPrice;
      total += (position.side == Side::Buy ? 1.0 : -1.0) *
               (price - position.entryPrice) * position.quantity;
    }
    return total;
  }

  bool execute(const std::string& line) {
    std::istringstream input(line);
    std::string command;
    input >> command;
    if (command.empty()) return true;
    if (command == "quit" || command == "exit") return false;
    if (command == "help") {
      std::cout << "Commands: markets [da|ida|bal], select <market-id>, "
                   "buy <quantity>, sell <quantity>, refresh, help, quit\n";
      return true;
    }
    if (command == "markets") {
      std::string tab;
      input >> tab;
      if (!tab.empty() && !setTab(tab)) {
        std::cout << "Unknown tab. Use da, ida, or bal.\n";
        return true;
      }
      render();
      return true;
    }
    if (command == "select") {
      std::string id;
      input >> id;
      Market* market = findMarket(id);
      if (!market) std::cout << "Unknown market ID: " << id << "\n";
      else selectMarket(market);
      return true;
    }
    if (command == "refresh") {
      updatePrices();
      render();
      return true;
    }
    if (command == "buy" || command == "sell") {
      int quantity = 0;
      std::string extra;
      if (!(input >> quantity) || (input >> extra) || quantity < 1 || quantity > 500) {
        std::cout << "Enter a whole quantity from 1 to 500, e.g. 'buy 10'.\n";
        return true;
      }
      executeTrade(command == "buy" ? Side::Buy : Side::Sell, quantity);
      render();
      return true;
    }
    std::cout << "Unknown command. Enter 'help' to see available commands.\n";
    return true;
  }

  bool setTab(const std::string& tab) {
    if (tab == "da") tab_ = Tab::DayAhead;
    else if (tab == "ida") tab_ = Tab::Intraday;
    else if (tab == "bal") tab_ = Tab::Balancing;
    else return false;
    selected_ = &currentMarkets().front();
    sessionHigh_ = -std::numeric_limits<double>::infinity();
    sessionLow_ = std::numeric_limits<double>::infinity();
    sessionPriceSum_ = 0.0;
    sessionPriceCount_ = 0;
    updateSessionStats();
    return true;
  }

  void executeTrade(Side side, int quantity) {
    const double marketPrice = selected_->price;
    const double signedSlippage = randomBetween(0.05, 0.35) *
                                  (side == Side::Buy ? 1.0 : -1.0);
    const double fillPrice = marketPrice + signedSlippage;
    const double pnl = (side == Side::Buy ? 1.0 : -1.0) *
                       (marketPrice - fillPrice) * quantity;
    positions_.push_back({selected_->id, side, quantity, fillPrice});
    trades_.push_back({utcTime(), selected_->name, side, quantity, fillPrice, pnl});
    sessionVolume_ += quantity;
  }

  std::string tabName() const {
    if (tab_ == Tab::Intraday) return "INTRADAY";
    if (tab_ == Tab::Balancing) return "BALANCING";
    return "DAY-AHEAD";
  }

  static std::string utcTime() {
    const std::time_t now = std::time(nullptr);
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &now);
#else
    gmtime_r(&now, &utc);
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%H:%M:%S");
    return output.str();
  }
};

}  // namespace

int main() {
  Terminal terminal;
  terminal.run();
  return 0;
}
