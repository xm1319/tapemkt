// xl-find-sale.js — 查 OrderGuard NFT 最近 Transfer 事件，定位真实成交 tx
const { ethers } = require('ethers');
(async () => {
  const p = new ethers.JsonRpcProvider('https://tapeout.net/rpc-xlayer');
  const PROC = '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355';
  const head = await p.getBlockNumber();
  const logs = await p.send('eth_getLogs', [{
    address: PROC,
    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'], // Transfer
    fromBlock: '0x' + (head - 5000).toString(16),
    toBlock: 'latest',
  }]);
  console.log('区块窗口:', head - 5000, '-', head, '| Transfer 数:', logs.length);
  for (const l of logs) {
    const from = '0x' + l.topics[1].slice(26);
    const to = '0x' + l.topics[2].slice(26);
    const id = parseInt(l.topics[3], 16);
    const blk = await p.getBlock(parseInt(l.blockNumber, 16));
    console.log('NFT#' + id, '| from', from.slice(0, 10) + '…', '→ to', to.slice(0, 10) + '…',
      '| blk', l.blockNumber, '| tx', l.transactionHash, '| 时间', new Date(blk.timestamp * 1000).toISOString());
  }
})().catch(e => console.error('ERR', e.message.slice(0, 300)));
