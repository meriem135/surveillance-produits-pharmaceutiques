import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder

from app.api.v1 import phase2
from app.services.realtime.feature_engineer import fridge_cond_encoding, thermo_status_encoding


def test_live_categorical_encodings_match_training():
    temps = np.array([3.0, 7.9, 8.1, 12.0])
    cond = np.where(temps > 8.0, "high", "low")
    trained = LabelEncoder().fit_transform(cond)
    assert [fridge_cond_encoding(t) for t in temps] == trained.tolist()
    assert thermo_status_encoding(24.5) == 0.0 and thermo_status_encoding(27.0) == 1.0


def test_split_keeps_attacks_out_of_training():
    n = 1000
    df = pd.DataFrame({"datetime": pd.date_range("2019-01-01", periods=n, freq="5min"),
                       "label": 0})
    df.loc[300:340, "label"] = 1
    df.loc[800:850, "label"] = 1
    train, val, test = phase2._split_tvt(df)
    assert train["label"].sum() == 0
    assert val["label"].sum() > 0 and test["label"].sum() > 0
    assert train["datetime"].max() < test["datetime"].min()


def test_threshold_comes_from_the_data_it_is_given():
    y_val = np.array([0, 0, 0, 1, 1])
    s_val = np.array([0.1, 0.2, 0.3, 0.8, 0.9])
    thr = phase2._best_f1_threshold(y_val, s_val)
    m = phase2._evaluate_pr(np.array([0, 1]), np.array([0.5, 0.85]), thr)
    assert m["threshold"] == thr and m["tp"] == 1 and m["fp"] == 0
