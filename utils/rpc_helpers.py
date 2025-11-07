from typing import Any, Iterable

def _walk(obj: Any, path: Iterable[str]) -> Any:
    cur = obj
    for key in path:
        if hasattr(cur, key):
            cur = getattr(cur, key)
        elif isinstance(cur, dict) and key in cur:
            cur = cur[key]
        else:
            raise KeyError(key)
    return cur

def resp_value(resp: Any) -> Any:
    """
    Универсально достаем .value из RPC-ответов (solders или dict).
    Поддерживаем пути:
      resp.value
      resp.result.value
      resp["result"]["value"], resp["value"]
    """
    # Прямой .value
    val = getattr(resp, "value", None)
    if val is not None:
        return val

    # dict-варианты
    if isinstance(resp, dict):
        if "result" in resp:
            r = resp["result"]
            if isinstance(r, dict) and "value" in r:
                return r["value"]
            return r
        if "value" in resp:
            return resp["value"]

    # solders объекты часто умеют to_json()
    to_json = getattr(resp, "to_json", None)
    if callable(to_json):
        try:
            j = to_json()
            import json
            d = json.loads(j) if isinstance(j, str) else j
            if isinstance(d, dict):
                if "result" in d and isinstance(d["result"], dict) and "value" in d["result"]:
                    return d["result"]["value"]
                if "value" in d:
                    return d["value"]
        except Exception:
            pass

    # крайний случай: вернуть исходник — пусть вызывающий разрулит
    return resp
