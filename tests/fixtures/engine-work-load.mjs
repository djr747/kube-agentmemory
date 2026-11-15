import assert from 'node:assert/strict';
import { closeSync, fsyncSync, openSync, statSync, writeFileSync } from 'node:fs';

const path = '/test-engine-work/integration-disk-load';
const block = Buffer.alloc(1024 ** 2, 0xa5);
const file = openSync(path, 'wx');
try {
  for (let blockNumber = 0; blockNumber < 1024; blockNumber++) writeFileSync(file, block);
  fsyncSync(file);
} finally {
  closeSync(file);
}
assert.ok(statSync(path).blocks * 512 >= 1024 ** 3, 'Disk load must allocate real space');
console.log('Engine work volume: allocated 1 GiB of disk load');
