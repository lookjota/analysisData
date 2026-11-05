from pandas import DataFrame
import talib.abstract as ta

from technical import qtpylib
from freqtrade.strategy import IStrategy


class OrionTrendStrategyV2(IStrategy):
    """
    Estratégia experimental:
    EMA 9/21 com filtro de tendência EMA 200.
    """

    timeframe = "5m"

    # Spot: permite apenas posições compradas.
    can_short = False

    # Histórico necessário para a EMA 200.
    startup_candle_count = 250

    # Não encerra operações por ROI pequeno.
    minimal_roi = {"0": 100.0}

    # Stop-loss experimental de 2%.
    stoploss = -0.02

    use_exit_signal = True
    process_only_new_candles = True

    def populate_indicators(
        self, dataframe: DataFrame, metadata: dict
    ) -> DataFrame:

        # Médias móveis exponenciais.
        dataframe["ema9"] = ta.EMA(dataframe, timeperiod=9)
        dataframe["ema21"] = ta.EMA(dataframe, timeperiod=21)
        dataframe["ema200"] = ta.EMA(dataframe, timeperiod=200)

        return dataframe

    def populate_entry_trend(
        self, dataframe: DataFrame, metadata: dict
    ) -> DataFrame:

        # Entrada:
        # 1. EMA 9 cruza acima da EMA 21.
        # 2. Preço está acima da EMA 200.
        # 3. EMA 200 está subindo.
        # 4. Volume positivo.
        bullish_cross = qtpylib.crossed_above(
            dataframe["ema9"], dataframe["ema21"]
        )

        above_trend = (
            dataframe["close"] > dataframe["ema200"]
        )

        rising_trend = (
            dataframe["ema200"] > dataframe["ema200"].shift(1)
        )

        valid_volume = dataframe["volume"] > 0

        dataframe.loc[
            bullish_cross
            & above_trend
            & rising_trend
            & valid_volume,
            ["enter_long", "enter_tag"]
        ] = (1, "ema_cross_trend")

        return dataframe

    def populate_exit_trend(
        self, dataframe: DataFrame, metadata: dict
    ) -> DataFrame:

        # Encerra após cruzamento de baixa
        # ou perda da EMA 200.
        bearish_cross = qtpylib.crossed_below(
            dataframe["ema9"], dataframe["ema21"]
        )

        below_trend = (
            dataframe["close"] < dataframe["ema200"]
        )

        valid_volume = dataframe["volume"] > 0

        dataframe.loc[
            (bearish_cross | below_trend) & valid_volume,
            ["exit_long", "exit_tag"]
        ] = (1, "trend_exit")

        return dataframe
