from spl.token._layouts import MINT_LAYOUT
from spl.token.instructions import 
from spl.token.constants import ExtensionType

def calculate_token2022_size(name: str, symbol: str, uri: str) -> int:
    """Вычисляет точный размер аккаунта для Token-2022 с метадатой"""
    
    # Базовый минт (82) + заголовки расширений
    extensions = [ExtensionType.METADATA_POINTER]
    base_size = get_mint_len(extensions)  # ≈ 165 байт
    
    # Обрезаем строки до лимитов
    name_bytes = name.encode("utf-8")[:32]
    symbol_bytes = symbol.encode("utf-8")[:10]
    uri_bytes = uri.encode("utf-8")[:200]
    
    # Размер ДАННЫХ TokenMetadata (без заголовка расширения, он уже в base_size)
    metadata_data_size = (
        1 +                      # Option flag для update_authority
        32 +                     # update_authority Pubkey
        32 +                     # mint Pubkey
        4 + len(name_bytes) +    # name String (u32 len prefix + bytes)
        4 + len(symbol_bytes) +  # symbol String
        4 + len(uri_bytes) +     # uri String
        4                        # additional_metadata Vec (empty, just length)
    )
    
    total = base_size + metadata_data_size
    
    print(f"📏 Token-2022 size breakdown:")
    print(f"   Base mint: {MINT_LAYOUT.sizeof()} bytes")
    print(f"   With extensions headers: {base_size} bytes")
    print(f"   Metadata data: {metadata_data_size} bytes")
    print(f"   Total: {total} bytes")
    
    return total

# Использование
mint_size = calculate_token2022_size(
    name="My Awesome Token",
    symbol="MAT",
    uri="https://arweave.net/abc123",
)

if __name__ == "__main__":
    calculate_token2022_size(
        name="My Awesome Token",
        symbol="MAT",
        uri="https://arweave.net/abc123",
    )