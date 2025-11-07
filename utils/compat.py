# utils/compat.py
from typing import Any, Iterable, Optional

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

def _to_str_blockhash(x: Any) -> str:
    if isinstance(x, str):
        return x
    if isinstance(x, (bytes, bytearray)):
        return x.decode()
    return str(x)

def _extract_blockhash_loose(resp: Any) -> str:
    """
    Терпимый извлекатель blockhash из любых вариантов ответа:
    - solders объекты: resp.value.blockhash, resp.value.value.blockhash
    - dict-ответы: ["result"]["value"]["blockhash"], ["value"]["blockhash"], ["blockhash"]
    - объекты с .value/.blockhash и т.п.
    """
    candidate_paths = [
        ("value", "blockhash"),
        ("value", "value", "blockhash"),
        ("result", "value", "blockhash"),
        ("value",),
        ("blockhash",),
    ]
    for path in candidate_paths:
        try:
            v = _walk(resp, path)
            return _to_str_blockhash(v)
        except Exception:
            pass

    # Попытка через to_json() (часто есть у solders-ответов)
    try:
        to_json = getattr(resp, "to_json", None)
        if callable(to_json):
            j = to_json()
            import json
            d = json.loads(j) if isinstance(j, str) else j
            for path in (("result","value","blockhash"), ("value","blockhash"), ("blockhash",)):
                try:
                    v = _walk(d, path)
                    return _to_str_blockhash(v)
                except Exception:
                    pass
    except Exception:
        pass

    raise TypeError(f"Unsupported blockhash response type: {type(resp)!r}")

def recent_blockhash(connection: Any, commitment: Optional[Any] = None) -> str:
    """
    Берёт latest blockhash у RPC и возвращает его строкой.
    ВАЖНО: здесь НЕТ рекурсий — только вызов RPC.
    """
    resp = (
        connection.get_latest_blockhash(commitment)
        if commitment is not None
        else connection.get_latest_blockhash()
    )
    return _extract_blockhash_loose(resp)
