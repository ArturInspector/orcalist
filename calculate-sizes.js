// Calculate exact sizes for Token-2022 with metadata
const {
  getMintLen,
  ExtensionType,
} = require('@solana/spl-token');

const {
  pack,
} = require('@solana/spl-token-metadata');

// Test different metadata lengths
const testCases = [
  { name: 'Short', symbol: 'SRT', uri: 'https://example.com/1.json' },
  { name: 'MyToken', symbol: 'MTK', uri: 'https://example.com/metadata.json' },
  { name: 'VeryLongTokenNameHere123456789', symbol: 'VLTNH', uri: 'https://example.com/very/long/path/to/metadata/file/that/is/really/long.json' },
];

console.log('=== Token-2022 Size Calculation ===\n');

// Base mint size
console.log('Base mint size (no extensions):', getMintLen([]));
console.log('Mint with MetadataPointer:', getMintLen([ExtensionType.MetadataPointer]));
console.log('');

testCases.forEach((testCase, i) => {
  const metadata = {
    mint: '11111111111111111111111111111111',  // dummy
    name: testCase.name,
    symbol: testCase.symbol,
    uri: testCase.uri,
    additionalMetadata: [],
  };
  
  const metadataLen = pack(metadata).length;
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const totalLen = mintLen + metadataLen;
  
  console.log(`Test case ${i + 1}: "${testCase.name}" / "${testCase.symbol}"`);
  console.log(`  Name: ${testCase.name.length} chars`);
  console.log(`  Symbol: ${testCase.symbol.length} chars`);
  console.log(`  URI: ${testCase.uri.length} chars`);
  console.log(`  Metadata pack length: ${metadataLen} bytes`);
  console.log(`  Mint length: ${mintLen} bytes`);
  console.log(`  Total: ${totalLen} bytes`);
  console.log('');
});

// Show extension type values
console.log('Extension types:');
console.log('  MetadataPointer:', ExtensionType.MetadataPointer);
console.log('  TokenMetadata:', ExtensionType.TokenMetadata);

