from pandas import DataFrame
import talib.abstract as ta
from technical import qtpylib
from freqtrade.strategy import IStrategy


class OrionMeanReversionV3(IStrategy):
    """
    Orion V3: reversao a media com filtro de tendencia.

    Instrumentos: pares Spot
    Timeframe: 1h
    Objetivo: avaliar recuperacoes de preco
    em tendencias de alta.
    """

    INTERFACE_VERSION = 3

    # Candles de uma hora.
    timeframe = "1h"

    # Mercado Spot: somente posicoes compradas.
    can_short = False

    # Historico necessario para a EMA 200.
    startup_candle_count = 250

    # Limite de perda experimental.
    stoploss = -0.025

    # Meta inicial de lucro: 1,5%.
    minimal_roi = {"0": 0.015}

    # Habilita a venda pelos sinais da estrategia.
    use_exit_signal = True

    # Nao utiliza stop movel.
    trailing_stop = False

    # Processa cada novo candle.
    process_only_new_candles = True

    def populate_indicators(
        self,
        dataframe: DataFrame,
        metadata: dict
    ) -> DataFrame:

        # Bollinger Bands:
        # janela de 20 candles e 2 desvios-padrao.
        upper, middle, lower = ta.BBANDS(
            dataframe["close"],
            timeperiod=20,
            nbdevup=2.0,
            nbdevdn=2.0,
            matype=0
        )

        dataframe["bb_upper"] = upper
        dataframe["bb_middle"] = middle
        dataframe["bb_lower"] = lower

        # Relative Strength Index: 14 candles.
        dataframe["rsi"] = ta.RSI(
            dataframe, timeperiod=14
        )

        # Exponential Moving Average: 200 candles.
        dataframe["ema200"] = ta.EMA(
            dataframe, timeperiod=200
        )

        return dataframe

    def populate_entry_trend(
        self,
        dataframe: DataFrame,
        metadata: dict
    ) -> DataFrame:

        # Preco cruza de baixo para cima
        # a banda inferior de Bollinger.
        recovery = qtpylib.crossed_above(
            dataframe["close"],
            dataframe["bb_lower"]
        )

        # RSI ainda relativamente baixo.
        weak_momentum = dataframe["rsi"] < 45

        # RSI atual maior que o RSI anterior.
        momentum_recovering = (
            dataframe["rsi"] > dataframe["rsi"].shift(1)
        )

        # Opera somente acima da tendencia longa.
        above_trend = (
            dataframe["close"] > dataframe["ema200"]
        )

        # Exige EMA 200 ascendente.
        rising_trend = (
            dataframe["ema200"] >
            dataframe["ema200"].shift(1)
        )

        # Rejeita candles sem volume.
        valid_volume = dataframe["volume"] > 0

        entry_condition = (
            recovery
            & weak_momentum
            & momentum_recovering
            & above_trend
            & rising_trend
            & valid_volume
        )

        dataframe.loc[
            entry_condition,
            ["enter_long", "enter_tag"]
        ] = (1, "bb_rsi_trend_recovery")

        return dataframe

    def populate_exit_trend(
        self,
        dataframe: DataFrame,
        metadata: dict
    ) -> DataFrame:

        # Retorno a media central de Bollinger.
        mean_reached = (
            dataframe["close"] >=
            dataframe["bb_middle"]
        )

        # Saida alternativa por RSI elevado.
        rsi_recovered = dataframe["rsi"] > 60

        exit_condition = (
            (mean_reached | rsi_recovered)
            & (dataframe["volume"] > 0)
        )

        dataframe.loc[
            exit_condition,
            ["exit_long", "exit_tag"]
        ] = (1, "mean_reversion_exit")

        return dataframe
