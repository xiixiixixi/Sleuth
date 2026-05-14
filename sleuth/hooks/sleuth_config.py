"""共享配置加载模块，供所有 hook 脚本使用。"""

import json
import os

CONFIG_PATH = os.path.expanduser("~/.sleuth/config.json")

DEFAULTS = {
    "blockWebTools": True,
    "routeSearchIntent": True,
    "blockedTools": None,
}


def load_config():
    """读取 sleuth 配置文件。文件不存在或损坏时返回安全默认值。"""
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return dict(DEFAULTS)
