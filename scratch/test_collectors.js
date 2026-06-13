const { collectCursor } = require('../src/collectors');

async function test() {
  console.log('Testing collectCursor()...');
  const result = await collectCursor();
  console.log('Result:', JSON.stringify(result, null, 2));
}

test();
