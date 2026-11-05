
from pandas import DataFrame
import talib.abstract as ta

from freqtrade.strategy import IStrategy
from technical import qtpylib


class OrionEmaStrategy(IStrategy):
    """
    Estratégia experimental EMA 9/21 para BTC/USDT Spot.
    Exclusivamente para backtesting e dry-run.
    """

    # Usa candles de cinco minutos.
    timeframe = "5m"

    # Não permite posições vendidas (short).
    can_short = False

    # Exige histórico para estabilizar os indicadores.
    startup_candle_count = 100

    # Retorno mínimo; a saída depende dos sinais e do stop.
    minimal_roi = {"0": 100.0}

    # Stop-loss experimental de 2%.
    stoploss = -0.02

    # Habilita sinais de saída.
    use_exit_signal = True

    # Processa apenas candles novos.
    process_only_new_candles = True

    def populate_indicators(
        self, dataframe: DataFrame, metadata: dict
    ) -> DataFrame:
        # EMA = Exponential Moving Average.
        dataframe["ema9"] = ta.EMA(dataframe, timeperiod=9)
        dataframe["ema21"] = ta.EMA(dataframe, timeperiod=21)

        return dataframe

    def populate_entry_trend(
        self, dataframe: DataFrame, metadata: dict
    ) -> DataFrame:
        # Entrada quando EMA9 cruza acima da EMA21.
        dataframe.loc[
            (
                qtpylib.crossed_above(
                    dataframe["ema9"], dataframe["ema21"]
                )
                & (dataframe["volume"] > 0)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "ema_bullish_cross")

        return dataframe

    def populate_exit_trend(
        self, dataframe: DataFrame, metadata: dict
    ) -> DataFrame:
        # Saída quando EMA9 cruza abaixo da EMA21.
        dataframe.loc[
            (
                qtpylib.crossed_below(
                    dataframe["ema9"], dataframe["ema21"]
                )
                & (dataframe["volume"] > 0)
            ),
            ["exit_long", "exit_tag"],
        ] = (1, "ema_bearish_cross")

        return dataframe
