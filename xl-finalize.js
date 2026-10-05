// xl-finalize.js — 补挂 EQ2(id5)、MAJ3(id3)，补 MAJ3 全 8 组合 eval 验证
'use strict';
const { ethers } = require('ethers');
const PROC = '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355';
const API = 'http://127.0.0.1:8787';
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const p = new ethers.JsonRpcProvider('https://tapeout.net/rpc-xlayer');
  const key = '0x' + fs.readFileSync('/root/secrets/signing.key', 'utf8').match(/^(0x)?([0-9a-fA-F]{64})$/m)[2];
  const w = new ethers.Wallet(key, p);
  const proc = new ethers.Contract(PROC, ['function eval(uint256,bytes) view returns (bytes)'], p);

  /* MAJ3 (id=3) 全 8 组合 */
  let pass = 0;
  for (let v = 0; v < 8; v++) {
    const ov = Number(ethers.toBigInt(await proc.eval(3, '0x' + v.toString(16).padStart(2, '0'))));
    const exp = ((v & 1) + (v >> 1 & 1) + (v >> 2 & 1) >= 2) ? 1 : 0;
    const ok = ov === exp; if (ok) pass++;
    console.log('MAJ3 ' + v.toString(2).padStart(3, '0') + ' → ' + ov + (ok ? ' ✓' : ' ✗'));
  }
  console.log('MAJ3 全组合: ' + pass + '/8');

  const list = async (id, name) => {
    const ts = Date.now();
    const msg = 'TapeOut市场·挂单确认\n卖家: ' + w.address + '\n品种: ' + PROC + ' #' + id + '\n数量: 1\n单价: 0.01 OKB\n时间: ' + ts;
    const sig = await w.signMessage(msg);
    const r = await fetch(API + '/api/mk/list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'xl', name, circuits: PROC, tokenId: id, qty: 1, priceBnb: '0.01', seller: w.address, ts, sig }),
    });
    const j = await r.json();
    console.log('挂单 #' + id + ' ' + name + ':', r.status, j.ok ? ('✅ 单号 ' + j.id) : JSON.stringify(j).slice(0, 120));
  };

  await sleep(31000);
  await list(5, '双钥比对器 EQ2');
  await sleep(31000);
  await list(3, '治理多数表决门 MAJ3');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
